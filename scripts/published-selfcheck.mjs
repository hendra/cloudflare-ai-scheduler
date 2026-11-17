// Assert-based self-check for scripts/published.mjs (no framework, offline).
// Run: node scripts/published-selfcheck.mjs
import assert from "node:assert/strict";

const {
  canonicalUrl,
  normalizeTitle,
  isSimilarTitle,
  buildPublishedIndex,
  fetchPublished,
  recordPublished,
} = await import("./published.mjs");

// 1. canonicalUrl
assert.equal(
  canonicalUrl("https://Example.com/post/?utm_source=hn&b=2&a=1#top"),
  "https://example.com/post?a=1&b=2",
);
assert.equal(canonicalUrl("https://example.com/"), "https://example.com/");
assert.equal(canonicalUrl("https://example.com"), "https://example.com/");
assert.equal(canonicalUrl("javascript:alert(1)"), "");
assert.equal(canonicalUrl("not a url"), "");
assert.equal(
  canonicalUrl("https://news.ycombinator.com/item?id=42&fbclid=abc&gclid=def&ref=hn&source=rss&mc_cid=1&mc_eid=2&igshid=x"),
  "https://news.ycombinator.com/item?id=42",
);

// 2. normalizeTitle & isSimilarTitle
assert.equal(normalizeTitle("  Café &amp; Résumé — Guide! "), "cafe resume guide");
assert.equal(
  isSimilarTitle("Introducing OpenAI GPT-5 for Developers", "OpenAI introduces GPT-5 for developers!"),
  true,
);
assert.equal(
  isSimilarTitle("Webb finds glass rain on exoplanet", "NASA Webb Finds Glass Rain on Exoplanet!"),
  true,
);
assert.equal(
  isSimilarTitle("Ruby on Rails 8 Release Notes", "PostgreSQL Vacuum Tuning Guide"),
  false,
);
assert.equal(isSimilarTitle("Rails 8 Guide", "Guide to Rails"), true);
assert.equal(isSimilarTitle("", "Anything"), false);

// 3. buildPublishedIndex
const idx = buildPublishedIndex([
  {
    item_key: "slug-1",
    title: "Alpha Post",
    url: "https://ex.com/a?utm_medium=rss",
    meta_json: '{"keyword":"alpha"}',
  },
  {
    item_key: "slug-2",
    title: "Beta Post",
    url: "https://ex.com/b/",
    meta_json: "{bad json",
  },
]);
assert.equal(idx.keys.has("slug-1"), true);
assert.equal(idx.keys.has("slug-2"), true);
assert.equal(idx.urls.has("https://ex.com/a"), true);
assert.equal(idx.urls.has("https://ex.com/b"), true);
assert.equal(idx.titles.includes("Alpha Post"), true);
assert.equal(idx.metaList.length, 1);
assert.equal(idx.metaList[0].keyword, "alpha");

// 4. fetchPublished env & dryRun semantics
const savedUrl = process.env.SCHEDULER_URL;
const savedToken = process.env.MANUAL_RUN_TOKEN;
const realFetch = globalThis.fetch;

try {
  delete process.env.SCHEDULER_URL;
  delete process.env.MANUAL_RUN_TOKEN;

  const dryRows = await fetchPublished({ pipeline: "inasoft-news", dryRun: true });
  assert.deepEqual(dryRows, []);

  await assert.rejects(
    () => fetchPublished({ pipeline: "inasoft-news", dryRun: false }),
    /SCHEDULER_URL/,
  );

  process.env.SCHEDULER_URL = "https://scheduler.example.com/";
  process.env.MANUAL_RUN_TOKEN = "secret-token";

  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch should not be called in dryRun");
  };
  const dryRec = await recordPublished({
    pipeline: "inasoft-news",
    items: [{ item_key: "x" }],
    dryRun: true,
  });
  assert.deepEqual(dryRec, { ok: true, inserted: 0 });
  assert.equal(fetchCalls, 0);

  // Mocked GET /api/published success (verifies URL, query params, and auth header)
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    assert.equal(u.origin, "https://scheduler.example.com");
    assert.equal(u.pathname, "/api/published");
    assert.equal(u.searchParams.get("pipeline"), "inasoft-news");
    assert.equal(u.searchParams.get("days"), "60");
    assert.equal(u.searchParams.get("limit"), "500");
    assert.equal(init.headers.Authorization, "Bearer secret-token");
    return new Response(JSON.stringify({ pipeline: "inasoft-news", items: [{ item_key: "k1" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const fetched = await fetchPublished({ pipeline: "inasoft-news", days: 60, limit: 500, dryRun: false });
  assert.deepEqual(fetched, [{ item_key: "k1" }]);

  // Mocked GET /api/published retries transient 503 once and succeeds on second attempt
  let getAttempts = 0;
  globalThis.fetch = async () => {
    getAttempts += 1;
    if (getAttempts === 1) return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify({ pipeline: "inasoft-news", items: [{ item_key: "k2" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const retried = await fetchPublished({ pipeline: "inasoft-news", dryRun: false });
  assert.equal(getAttempts, 2);
  assert.deepEqual(retried, [{ item_key: "k2" }]);

  // Mocked GET /api/published 401 fails closed immediately without retrying
  let authAttempts = 0;
  globalThis.fetch = async () => {
    authAttempts += 1;
    return new Response("Unauthorized", { status: 401 });
  };
  await assert.rejects(
    () => fetchPublished({ pipeline: "inasoft-news", dryRun: false }),
    /HTTP 401/,
  );
  assert.equal(authAttempts, 1);

  // Mocked POST /api/published HTTP 500 does not throw and returns { ok: false, inserted: 0 }
  globalThis.fetch = async () => new Response("server error", { status: 500 });
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const failRec = await recordPublished({
      pipeline: "inasoft-news",
      items: [{ item_key: "x" }],
      dryRun: false,
    });
    assert.deepEqual(failRec, { ok: false, inserted: 0 });
    assert.ok(warnings.some((w) => w.includes("::warning::")));
  } finally {
    console.warn = origWarn;
  }

  // Mocked POST /api/published chunks >50 items into batches of <=50
  const batchSizes = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    batchSizes.push(body.items.length);
    return new Response(JSON.stringify({ ok: true, inserted: body.items.length }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const manyItems = Array.from({ length: 75 }, (_, i) => ({ item_key: `item-${i}` }));
  const batchRec = await recordPublished({
    pipeline: "inasoft-news",
    items: manyItems,
    dryRun: false,
  });
  assert.deepEqual(batchSizes, [50, 25]);
  assert.deepEqual(batchRec, { ok: true, inserted: 75 });
} finally {
  globalThis.fetch = realFetch;
  if (savedUrl === undefined) delete process.env.SCHEDULER_URL;
  else process.env.SCHEDULER_URL = savedUrl;
  if (savedToken === undefined) delete process.env.MANUAL_RUN_TOKEN;
  else process.env.MANUAL_RUN_TOKEN = savedToken;
}

console.log("published self-check: ok");
