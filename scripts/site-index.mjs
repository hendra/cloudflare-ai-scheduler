// After a blog article is merged: wait until it is live, then tell search engines.
//   Bing/Yandex — IndexNow ping with the article URL (key file is public on each site).
//   Google      — resubmit <site>/sitemap-index.xml via the Search Console API
//                 (service account in GSC_SERVICE_ACCOUNT_JSON, added as Owner in GSC).
// Never throws: the article is already published; every outcome is a short string
// ("ok" | "skipped: …" | "failed: …") for the Slack note.
// env.INDEXNOW_DRY=1 skips the IndexNow call (used by site-index-selfcheck.mjs).
import { createSign } from "node:crypto";

const FETCH_TIMEOUT_MS = 20000;
const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GSC_API = "https://www.googleapis.com/webmasters/v3";

const reason = (e) => String(e?.message || e).replace(/\s+/g, " ").slice(0, 150);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url, init = {}) => fetch(url, { redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), ...init });

// First <loc> whose last non-empty path segment is exactly `slug` (not a substring match).
export function matchSitemapLoc(xml, slug) {
  for (const [, loc] of String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    try {
      const segs = new URL(loc).pathname.split("/").filter(Boolean);
      if (segs[segs.length - 1] === slug) return loc;
    } catch { /* malformed loc */ }
  }
  return null;
}

async function waitForLive(siteUrl, slug, waitMs, pollMs) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const res = await get(`${siteUrl}/sitemap-0.xml`, { headers: { "cache-control": "no-cache" } });
      const url = res.ok ? matchSitemapLoc(await res.text(), slug) : null;
      if (url && (await get(url)).status === 200) return url;
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
  if (res.status === 200 || res.status === 202) return "ok";
  return `failed: IndexNow HTTP ${res.status} ${(await res.text()).slice(0, 80)}`.trim();
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
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`token HTTP ${res.status} ${body.error || ""}`.trim());
  return body.access_token;
}

async function submitGoogleSitemap(siteUrl, saJson) {
  const sa = JSON.parse(saJson);
  if (!sa.client_email || !sa.private_key) throw new Error("service account JSON lacks client_email/private_key");
  const auth = { authorization: `Bearer ${await googleAccessToken(sa)}` };
  const list = await get(`${GSC_API}/sites`, { headers: auth });
  if (!list.ok) throw new Error(`sites.list HTTP ${list.status}`);
  const host = new URL(siteUrl).host;
  const wanted = new Set([`sc-domain:${host}`, `${siteUrl}/`]);
  const entry = ((await list.json()).siteEntry || []).find((s) => wanted.has(s.siteUrl) && s.permissionLevel !== "siteUnverifiedUser");
  if (!entry) return "skipped: service account not added to Search Console";
  const res = await get(`${GSC_API}/sites/${encodeURIComponent(entry.siteUrl)}/sitemaps/${encodeURIComponent(`${siteUrl}/sitemap-index.xml`)}`, { method: "PUT", headers: auth });
  if (res.ok) return "ok";
  return `failed: sitemaps.submit HTTP ${res.status}`;
}

export async function indexArticle({ siteUrl, slug, indexNowKey, env, waitMs = 600000, pollMs = 30000 }) {
  const url = await waitForLive(siteUrl, slug, waitMs, pollMs);
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
