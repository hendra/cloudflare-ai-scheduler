// Self-check for scripts/site-index.mjs. Hits the live railsdev.io sitemap; never pings
// search engines (INDEXNOW_DRY) and never uses real Google credentials.
import assert from "node:assert/strict";
import { matchSitemapLoc, indexArticle } from "./site-index.mjs";

const xml = "<loc>https://x.io/blog/foo-bar</loc><loc>https://x.io/blog/a/b/foo/</loc>";
assert.equal(matchSitemapLoc(xml, "foo"), "https://x.io/blog/a/b/foo/");
assert.equal(matchSitemapLoc(xml, "nope"), null);

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

console.log("site-index selfcheck: all assertions passed");
