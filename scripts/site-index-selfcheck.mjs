// Self-check for scripts/site-index.mjs. Hits the live railsdev.io sitemap; never pings
// search engines (INDEXNOW_DRY) and never uses real Google credentials.
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

console.log("site-index selfcheck: all assertions passed");
