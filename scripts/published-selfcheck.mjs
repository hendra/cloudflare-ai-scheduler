// Assert-based self-check for scripts/published.mjs (no framework, offline).
// Run: node scripts/published-selfcheck.mjs
import assert from "node:assert/strict";

const {
  canonicalUrl,
  normalizeTitle,
  isSimilarTitle,
  buildPublishedIndex,
  filterUnseenCandidates,
  fetchPublished,
  recordPublished,
  loadOpenPrs,
  checkTopicCollision,
  loadBlogCorpus,
  buildBlogHistory,
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

// 3b. filterUnseenCandidates (news URL/title dedupe + minimum-4 check; job URL/dedupeKey collision)
assert.equal(typeof filterUnseenCandidates, "function");

const newsIdx = buildPublishedIndex([
  {
    item_key: "https://tech.example.com/gpt-5",
    title: "Introducing OpenAI GPT-5 for Developers",
    url: "https://tech.example.com/gpt-5",
  },
]);
const newsCandidates = [
  { url: "https://tech.example.com/gpt-5/?utm_source=rss", title: "Completely different headline" }, // URL match
  { url: "https://other.example.com/story", title: "OpenAI introduces GPT-5 for developers!" }, // similar title to index
  { url: "https://a.example.com/rails-8?ref=hn", title: "Ruby on Rails 8.1 Released" }, // keep
  { url: "https://a.example.com/rails-8/", title: "Ruby on Rails 8.1 Released" }, // within-run canonical URL dup
  { url: "https://b.example.com/rails-8-mirror", title: "Ruby on Rails 8.1 released today!" }, // within-run similar title dup
  { url: "https://c.example.com/postgres", title: "PostgreSQL 18 Vacuum Improvements" }, // keep
  { url: "https://d.example.com/deno", title: "Deno 3 Runtime Benchmarks" }, // keep
];
const unseenNews = filterUnseenCandidates(newsCandidates, newsIdx, {
  getUrl: (s) => s.url,
  getTitle: (s) => s.title,
});
assert.equal(unseenNews.length, 3);
assert.deepEqual(
  unseenNews.map((s) => s.url),
  [
    "https://a.example.com/rails-8?ref=hn",
    "https://c.example.com/postgres",
    "https://d.example.com/deno",
  ],
);
assert.equal(unseenNews.length < 4, true); // triggers digest minimum-4 clean skip

const jobDedupeKey = (j) =>
  (j.company || "").toLowerCase().replace(/[^a-z0-9]+/g, "") +
  "|" +
  (j.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const jobIdx = buildPublishedIndex([
  {
    item_key: "https://jobs.example.com/acme-rails",
    title: "Acme — Senior Rails Engineer",
    url: "https://jobs.example.com/acme-rails",
    meta_json: JSON.stringify({ dedupeKey: "acme|seniorrailsengineer" }),
  },
  {
    item_key: "job:beta|staffrails",
    title: "Beta — Staff Rails",
    url: "",
    meta_json: JSON.stringify({ dedupeKey: "beta|staffrails" }),
  },
]);
const jobSeenKeys = new Set([
  ...jobIdx.keys,
  ...jobIdx.metaList.map((m) => m.dedupeKey).filter(Boolean),
]);
const jobCandidates = [
  { company: "Acme Corp", title: "Rails Dev", url: "https://jobs.example.com/acme-rails/?utm_source=remotive" }, // URL match
  { company: "Acme", title: "Senior Rails Engineer", url: "https://remoteok.com/l/123" }, // dedupeKey match via meta
  { company: "Beta", title: "Staff Rails", url: "https://hn.example.com/item?id=99" }, // dedupeKey match from URL-less record
  { company: "Gamma", title: "Senior Rails Engineer", url: "https://gamma.example.com/jobs/rails" }, // same title, different company -> keep
];
const unseenJobs = filterUnseenCandidates(jobCandidates, jobIdx, {
  getUrl: (j) => j.url,
  getKey: jobDedupeKey,
  extraKeys: jobSeenKeys,
});
assert.equal(unseenJobs.length, 1);
assert.equal(unseenJobs[0].company, "Gamma");

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

// 5. checkTopicCollision, loadOpenPrs, loadBlogCorpus, buildBlogHistory
assert.equal(typeof checkTopicCollision, "function");
assert.equal(typeof loadOpenPrs, "function");
assert.equal(typeof loadBlogCorpus, "function");
assert.equal(typeof buildBlogHistory, "function");

const blogHistory = {
  slugs: new Set(["rails-8-sqlite-queue-guide", "open-pr-slug"]),
  urls: new Set(["https://github.com/rails/solid_queue"]),
  titles: [
    "Rails 8 Solid Queue in Production: A Practical Guide",
    "content: add open-pr-slug",
    "Zero-Downtime PostgreSQL Migrations in Rails",
  ],
  keywords: new Set(["rails solid queue", "postgresql migrations"]),
};

// 5a. matching slug
const slugHit = checkTopicCollision(
  {
    slug: "rails-8-sqlite-queue-guide",
    title: "Completely Unique Article Title Here",
    topic: "Unique Topic Name",
    keyword: "unique keyword",
    signalUrl: "https://example.com/fresh-signal",
  },
  blogHistory,
);
assert.ok(slugHit && /slug/i.test(slugHit), `expected slug collision, got: ${slugHit}`);

// 5b. matching signalUrl with UTM params
const urlHit = checkTopicCollision(
  {
    slug: "brand-new-slug",
    title: "Completely Unique Article Title Here",
    topic: "Unique Topic Name",
    keyword: "unique keyword",
    signalUrl: "https://github.com/rails/solid_queue/?utm_source=trending&ref=daily#readme",
  },
  blogHistory,
);
assert.ok(urlHit && /url/i.test(urlHit), `expected signalUrl collision, got: ${urlHit}`);

// 5c. similar title
const titleHit = checkTopicCollision(
  {
    slug: "brand-new-slug",
    title: "Zero-Downtime PostgreSQL Migrations with Rails",
    topic: "Unique Topic Name",
    keyword: "unique keyword",
    signalUrl: "https://example.com/fresh-signal",
  },
  blogHistory,
);
assert.ok(titleHit && /title/i.test(titleHit), `expected title collision, got: ${titleHit}`);

// 5d. similar topic
const topicHit = checkTopicCollision(
  {
    slug: "brand-new-slug",
    title: "Something Completely Different for Readers",
    topic: "PostgreSQL Zero-Downtime Migrations in Rails",
    keyword: "unique keyword",
    signalUrl: "https://example.com/fresh-signal",
  },
  blogHistory,
);
assert.ok(topicHit && /topic/i.test(topicHit), `expected topic collision, got: ${topicHit}`);

// 5e. exact normalized keyword
const kwHit = checkTopicCollision(
  {
    slug: "brand-new-slug",
    title: "Completely Unique Article Title Here",
    topic: "Unique Topic Name",
    keyword: "  Rails  Solid-Queue! ",
    signalUrl: "https://example.com/fresh-signal",
  },
  blogHistory,
);
assert.ok(kwHit && /keyword/i.test(kwHit), `expected keyword collision, got: ${kwHit}`);

// 5f. non-colliding topic returns null
const noHit = checkTopicCollision(
  {
    slug: "deno-3-native-http-benchmarks",
    title: "Deno 3 Native HTTP Server Benchmarks for Backend Teams",
    topic: "Deno 3 HTTP Server Performance",
    keyword: "deno 3 http benchmarks",
    signalUrl: "https://deno.com/blog/v3",
  },
  blogHistory,
);
assert.equal(noHit, null);

// 5g. loadOpenPrs returns empty sets cleanly when PAT is missing
{
  const origWarn = console.warn;
  const warns = [];
  console.warn = (...args) => warns.push(args.join(" "));
  try {
    const res = loadOpenPrs({ siteDir: process.cwd(), pat: "" });
    assert.equal(res.slugs instanceof Set, true);
    assert.equal(res.slugs.size, 0);
    assert.deepEqual(res.titles, []);
    assert.ok(warns.some((w) => w.includes("loadOpenPrs")));
  } finally {
    console.warn = origWarn;
  }
}

// 5h. loadBlogCorpus & buildBlogHistory
{
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const tmpSite = mkdtempSync(join(tmpdir(), "blog-corpus-test-"));
  try {
    const blogDir = join(tmpSite, "src/content/blog");
    mkdirSync(blogDir, { recursive: true });
    writeFileSync(
      join(blogDir, "first-post.md"),
      `---\ntitle: "First \\"Quoted\\" Post"\nseoTitle: 'First SEO Title'\nkeyword: "Rails Caching"\n---\n\n## Intro\n\ntitle: "Not Frontmatter"\n`,
    );
    writeFileSync(
      join(blogDir, "second-post.md"),
      `---\ntitle: Unquoted Second Post\n---\n\nBody text.\n`,
    );
    writeFileSync(join(blogDir, "notes.txt"), "ignore non-md");

    const corpus = loadBlogCorpus(tmpSite);
    assert.equal(corpus.length, 2);
    const first = corpus.find((c) => c.slug === "first-post");
    assert.equal(first.title, 'First "Quoted" Post');
    assert.equal(first.seoTitle, "First SEO Title");
    assert.equal(first.keyword, "Rails Caching");

    const second = corpus.find((c) => c.slug === "second-post");
    assert.equal(second.title, "Unquoted Second Post");
    assert.equal(second.keyword, "");
    assert.equal(second.seoTitle, "");

    const combined = buildBlogHistory({
      corpus,
      openPrs: { slugs: new Set(["pending-pr-slug"]), titles: ["Pending PR Article"] },
      publishedRows: [
        {
          item_key: "d1-only-slug",
          title: "D1 Historical Post",
          url: "https://example.com/sig?utm_source=hn",
          meta_json: JSON.stringify({ keyword: "Historical Keyword" }),
        },
      ],
    });
    assert.equal(combined.slugs.has("first-post"), true);
    assert.equal(combined.slugs.has("pending-pr-slug"), true);
    assert.equal(combined.slugs.has("d1-only-slug"), true);
    assert.equal(combined.urls.has("https://example.com/sig"), true);
    assert.equal(combined.titles.includes('First "Quoted" Post'), true);
    assert.equal(combined.titles.includes("First SEO Title"), true);
    assert.equal(combined.titles.includes("Pending PR Article"), true);
    assert.equal(combined.titles.includes("D1 Historical Post"), true);
    assert.equal(combined.keywords.has("rails caching"), true);
    assert.equal(combined.keywords.has("historical keyword"), true);
  } finally {
    rmSync(tmpSite, { recursive: true, force: true });
  }
}

console.log("published self-check: ok");
