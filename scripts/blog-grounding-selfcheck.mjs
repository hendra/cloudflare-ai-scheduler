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

console.log("blog-grounding-selfcheck: ok");
