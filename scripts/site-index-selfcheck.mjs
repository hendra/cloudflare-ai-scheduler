// Self-check for scripts/site-index.mjs. Never pings search engines (INDEXNOW_DRY) and never
// uses real Google credentials. NEEDS NETWORK: it reads the live railsdev.io sitemaps and
// expects the article `rails-monitoring-uptime-kuma` to exist — if that article is ever
// renamed/removed, swap in another live railsdev slug.
import assert from "node:assert/strict";
import { matchSitemapLoc, indexArticle, sitemapLocs } from "./site-index.mjs";

const xml = "<loc>https://x.io/blog/foo-bar</loc><loc>https://x.io/blog/a/b/foo/</loc>";
assert.equal(matchSitemapLoc(xml, "foo"), "https://x.io/blog/a/b/foo/");
assert.equal(matchSitemapLoc(xml, "nope"), null);
// A loc that already existed before the merge (e.g. a pillar page sharing the slug) is never "the new article".
assert.equal(matchSitemapLoc(xml, "foo", new Set(["https://x.io/blog/a/b/foo/"])), null);

const notLive = await indexArticle({ siteUrl: "https://railsdev.io", slug: "no-such-slug-zz", indexNowKey: "k", env: {}, waitMs: 1000, pollMs: 500 });
assert.equal(notLive.live, false);
assert.match(notLive.bing, /^skipped: not live/);
assert.match(notLive.google, /^skipped: not live/);

const live = { siteUrl: "https://railsdev.io", slug: "rails-monitoring-uptime-kuma", indexNowKey: "85dd4d96ba8c4f5ca1e8c7f26ddffb80" };
const noCreds = await indexArticle({ ...live, env: { INDEXNOW_DRY: "1" } });
assert.equal(noCreds.live, true);
assert.equal(noCreds.url, "https://railsdev.io/blog/rails-monitoring-uptime-kuma");
assert.equal(noCreds.bing, "skipped: INDEXNOW_DRY");
assert.equal(noCreds.google, "skipped: no credentials");

const badCreds = await indexArticle({ ...live, env: { INDEXNOW_DRY: "1", GSC_SERVICE_ACCOUNT_JSON: "{bad" } });
assert.match(badCreds.google, /^failed:/);

// Slug already live before the merge → not detected as the new article.
const before = await sitemapLocs("https://railsdev.io");
assert.ok(before.has("https://railsdev.io/blog/rails-monitoring-uptime-kuma"));
const preexisting = await indexArticle({ ...live, env: { INDEXNOW_DRY: "1" }, knownLocs: before, waitMs: 1000, pollMs: 500 });
assert.equal(preexisting.live, false);

// Google responses, stubbed (no real credentials): Restricted access → clear skip;
// API errors keep Google's error.message.
{
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const sa = JSON.stringify({ client_email: "t@x.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
  const realFetch = globalThis.fetch;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const stub = (sites, putStatus = 200) => async (url, init) => {
    const u = String(url);
    if (u.startsWith("https://oauth2.googleapis.com/token")) return json(200, { access_token: "tok" });
    if (u.endsWith("/webmasters/v3/sites")) return json(200, { siteEntry: sites });
    if (init?.method === "PUT") return json(putStatus, { error: { message: "User does not have sufficient permission" } });
    return realFetch(url, init);
  };
  try {
    globalThis.fetch = stub([{ siteUrl: "sc-domain:railsdev.io", permissionLevel: "siteRestrictedUser" }]);
    let r = await indexArticle({ ...live, env: { INDEXNOW_DRY: "1", GSC_SERVICE_ACCOUNT_JSON: sa } });
    assert.match(r.google, /^skipped: service account has Restricted access/);
    globalThis.fetch = stub([{ siteUrl: "sc-domain:railsdev.io", permissionLevel: "siteFullUser" }], 403);
    r = await indexArticle({ ...live, env: { INDEXNOW_DRY: "1", GSC_SERVICE_ACCOUNT_JSON: sa } });
    assert.equal(r.google, "failed: sitemaps.submit HTTP 403 User does not have sufficient permission");
    globalThis.fetch = stub([{ siteUrl: "sc-domain:railsdev.io", permissionLevel: "siteOwner" }]);
    r = await indexArticle({ ...live, env: { INDEXNOW_DRY: "1", GSC_SERVICE_ACCOUNT_JSON: sa } });
    assert.equal(r.google, "ok");
  } finally { globalThis.fetch = realFetch; }
}

console.log("site-index selfcheck: all assertions passed");
