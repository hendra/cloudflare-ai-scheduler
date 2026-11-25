// Assert-based self-check for scripts/blog-grounding.mjs (offline; fetch is stubbed).
// Run: node scripts/blog-grounding-selfcheck.mjs
import assert from "node:assert/strict";
const { groundArticle } = await import("./blog-grounding.mjs");

const article = (body) => ({ title: "t", slug: "s", description: "d", keyword: "k", body });
const fakeFetch = async (url) => ({ ok: true, status: 200, url, text: `Docs for ${url}. ` + "Filler paragraph. ".repeat(20) + "Limit is 512 MB." });

// Grounded on first try: no repair call.
let calls = 0;
const pass = await groundArticle({ article: article("Limit is 512 MB."), links: ["https://a.test/doc"], signalUrl: null, callModel: async () => { calls++; return ""; }, fetchSourceText: fakeFetch });
assert.equal(pass.ok, true);
assert.equal(calls, 0);

// Invented number: one repair call receives the source text, then passes.
const prompts = [];
const repaired = await groundArticle({
  article: article("Limit is 999 MB."),
  links: ["https://a.test/doc"],
  signalUrl: null,
  callModel: async (p) => { prompts.push(p); return "Limit is 512 MB."; },
  fetchSourceText: fakeFetch,
});
assert.equal(repaired.ok, true);
assert.equal(prompts.length, 1);
assert.ok(prompts[0].includes("512 MB"), "repair prompt carries the source text");

// Still ungrounded after repair: clean skip, no throw.
const skipped = await groundArticle({
  article: article("Limit is 999 MB."),
  links: ["https://a.test/doc"],
  signalUrl: null,
  callModel: async () => "Limit is 999 MB.",
  fetchSourceText: fakeFetch,
});
assert.equal(skipped.ok, false);
assert.deepEqual(skipped.unverified, ["999"]);

// A signal page that does not fetch is dropped, never a dead source.
const noSignal = await groundArticle({
  article: article("Limit is 512 MB."),
  links: ["https://a.test/doc"],
  signalUrl: "https://signal.test/nope",
  callModel: async () => "",
  fetchSourceText: async (url) => (url.includes("signal") ? { ok: false, status: 403, url, text: "" } : fakeFetch(url)),
});
assert.equal(noSignal.ok, true);

// A citation the repair introduces must be fetched too, not shipped unread.
const newLink = await groundArticle({
  article: article("Limit is 999 MB."),
  links: ["https://a.test/doc"],
  signalUrl: null,
  callModel: async () => "Limit is 512 MB. See [the spec](https://dead.test/x) for details.",
  fetchSourceText: async (url) => (url.includes("dead.test") ? { ok: false, status: 404, url, text: "" } : fakeFetch(url)),
});
assert.equal(newLink.ok, false);
assert.deepEqual(newLink.deadSources, ["https://dead.test/x"]);

// A provider error during the repair is a clean skip, not a crashed pipeline.
const boom = await groundArticle({
  article: article("Limit is 999 MB."),
  links: ["https://a.test/doc"],
  signalUrl: null,
  callModel: async () => { throw new Error("429"); },
  fetchSourceText: fakeFetch,
});
assert.equal(boom.ok, false);
assert.deepEqual(boom.unverified, ["999"]);

// An already-fetched signal page is reused, not fetched twice.
const fetched = [];
const reused = await groundArticle({
  article: article("Limit is 512 MB."),
  links: ["https://a.test/doc"],
  signalUrl: "https://signal.test/page",
  signalText: "Signal page. " + "Filler text. ".repeat(20),
  callModel: async () => "",
  fetchSourceText: async (url) => { fetched.push(url); return fakeFetch(url); },
});
assert.equal(reused.ok, true);
assert.deepEqual(fetched, ["https://a.test/doc"], "signal page not fetched again");

// A provider error during the repair call is a clean skip, never a thrown run.
const providerDown = await groundArticle({
  article: article("Limit is 999 MB."),
  links: ["https://a.test/doc"],
  signalUrl: null,
  callModel: async () => { throw new Error("429 hard usage limit"); },
  fetchSourceText: fakeFetch,
});
assert.equal(providerDown.ok, false);
assert.deepEqual(providerDown.unverified, ["999"]);

// A citation the repair removed is not dead any more: the article ships.
const replacedLink = await groundArticle({
  article: article("Limit is 999 MB. See [old](https://dead.test/x)."),
  links: ["https://a.test/doc", "https://dead.test/x"],
  signalUrl: null,
  callModel: async () => "Limit is 512 MB. See [docs](https://a.test/doc).",
  fetchSourceText: async (url) => (url.includes("dead.test") ? { ok: false, status: 404, url, text: "" } : fakeFetch(url)),
});
assert.equal(replacedLink.ok, true, "a dead citation the repair dropped must not block");

// A plain-http citation the repair introduces is fetched too.
const httpLink = await groundArticle({
  article: article("Limit is 999 MB."),
  links: ["https://a.test/doc"],
  signalUrl: null,
  callModel: async () => "Limit is 512 MB. See [spec](http://dead.test/x).",
  fetchSourceText: async (url) => (url.includes("dead.test") ? { ok: false, status: 404, url, text: "" } : fakeFetch(url)),
});
assert.equal(httpLink.ok, false);
assert.deepEqual(httpLink.deadSources, ["http://dead.test/x"]);

// A bare URL the repair introduces is fetched too, so a dead one cannot slip past unread.
const bareUrl = await groundArticle({
  article: article("Limit is 999 MB."),
  links: ["https://a.test/doc"],
  signalUrl: null,
  callModel: async () => "Limit is 512 MB. Source: https://dead.test/x",
  fetchSourceText: async (url) => (url.includes("dead.test") ? { ok: false, status: 404, url, text: "" } : fakeFetch(url)),
});
assert.equal(bareUrl.ok, false);
assert.deepEqual(bareUrl.deadSources, ["https://dead.test/x"]);

// Trailing sentence punctuation on a bare URL must not corrupt the URL fetched.
const barePunct = await groundArticle({
  article: article("Limit is 999 MB."),
  links: ["https://a.test/doc"],
  signalUrl: null,
  callModel: async () => "Limit is 512 MB. See https://a.test/extra. Or <https://a.test/extra2>!",
  fetchSourceText: async (url) => {
    assert.ok(!/[.>!]/.test(url.slice(-1)), "trailing punctuation leaked: " + url);
    return fakeFetch(url);
  },
});
assert.equal(barePunct.ok, true);

console.log("blog-grounding-selfcheck: ok");

// An example hostname is not a citation: never fetched, never reported dead.
const seen = [];
const exampleOnly = await groundArticle({
  article: article("Limit is 512 MB."),
  links: ["https://a.test/doc", "http://rails_app", "http://$upstream/health"],
  signalUrl: null,
  callModel: async () => "",
  fetchSourceText: async (url) => { seen.push(url); return fakeFetch(url); },
});
assert.equal(exampleOnly.ok, true);
assert.deepEqual(seen, ["https://a.test/doc"], "non-citations must not be fetched");

// A repair that introduces an example hostname does not make it dead.
const repairSeen = [];
const repairExample = await groundArticle({
  article: article("Limit is 999 MB."),
  links: ["https://a.test/doc"],
  signalUrl: null,
  callModel: async () => "Limit is 512 MB. Start it with `docker compose up` and hit [the app](http://rails_app).",
  fetchSourceText: async (url) => { repairSeen.push(url); return fakeFetch(url); },
});
assert.equal(repairExample.ok, true);
assert.deepEqual(repairSeen, ["https://a.test/doc"], "the repair's example hostname must not be fetched");
