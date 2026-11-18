// Assert-based self-check for scripts/grounding.mjs (offline; no framework).
// Run: node scripts/grounding-selfcheck.mjs
import assert from "node:assert/strict";

const { numbersIn, riskyNumbers, proseOnly, extractPageText, fetchSourceText, checkGrounding } =
  await import("./grounding.mjs");

// --- numbersIn: Indonesian vs English scale words, thousands vs decimal ---
assert.deepEqual([...numbersIn("8.700 pengguna")], ["8700"]);
assert.deepEqual([...numbersIn("8,700 users")], ["8700"]);
assert.deepEqual([...numbersIn("1,5 juta")], ["1.5", "1500000"]);
assert.deepEqual([...numbersIn("1,5 juta", { keepRaw: false })], ["1500000"]);
assert.deepEqual([...numbersIn("33 ribu orang")], ["33", "33000"]);
assert.deepEqual([...numbersIn("no digits here")], []);

// --- riskyNumbers: years exempt, small counts exempt, percent/currency/version kept ---
assert.deepEqual(riskyNumbers("shipped in 2026 with 3 layers"), []);
assert.deepEqual(riskyNumbers("since Node 20"), ["20"]);
assert.deepEqual(riskyNumbers("40% faster"), ["40"]);
assert.deepEqual(riskyNumbers("costs $19 per seat"), ["19"]);
assert.deepEqual(riskyNumbers("GPT-4o and the older model"), ["4"]);
assert.deepEqual(riskyNumbers("1,000 requests"), ["1000"]);

// --- proseOnly: code and URLs are not claims ---
const md = [
  "Set memory to `--max-old-space-size=4096` and see 4096 MB.",
  "```bash",
  "curl -X POST https://api.example.com/v2/items?limit=500",
  "```",
  "Then read [the docs](https://nodejs.org/api/stream.html#api-12345).",
].join("\n");
const prose = proseOnly(md);
assert.ok(prose.includes("4096 MB"), "plain prose numbers stay");
assert.ok(!prose.includes("example.com"), "link URLs and fenced code must be stripped");
assert.ok(!prose.includes("--max-old-space-size"), "inline code must be stripped");
assert.ok(prose.includes("the docs"), "link text stays");

// --- extractPageText: RFC-style <pre> bodies count ---
const html = '<nav>skip me</nav><pre>1.  Introduction\n   The value MUST be 4096.</pre><p>Also 200.</p>';
const text = extractPageText(html);
assert.ok(text.includes("4096") && text.includes("200"));
assert.ok(!text.includes("skip me"), "nav stripped");

// --- fetchSourceText: 200 with no body text is a dead source, non-HTML is refused ---
const stubFetch = (body, type = "text/html; charset=utf-8", status = 200) => async () =>
  new Response(body, { status, headers: { "content-type": type } });
const realFetch = globalThis.fetch;
const longHtml = "<p>" + "Streams buffer chunks. ".repeat(20) + "</p>";
globalThis.fetch = stubFetch(longHtml);
assert.equal((await fetchSourceText("https://a.test/doc")).ok, true);
globalThis.fetch = stubFetch("<p>short</p>");
assert.equal((await fetchSourceText("https://a.test/doc")).ok, false, "200 with no body text is dead");
globalThis.fetch = stubFetch(JSON.stringify({ ok: 1 }), "application/json");
assert.equal((await fetchSourceText("https://a.test/api")).ok, false, "non-HTML is refused");
globalThis.fetch = stubFetch(longHtml, "text/html", 404);
assert.equal((await fetchSourceText("https://a.test/missing")).ok, false, "non-2xx is dead");
globalThis.fetch = realFetch;

// --- checkGrounding: invented numbers and dead sources both fail ---
const sources = [{ url: "https://nodejs.org/api/stream.html", text: "Streams buffer up to 16 KB by default. ".repeat(8) + "Released in 2026." }];
assert.equal(checkGrounding({ body: "Streams buffer up to 16 KB by default.", sources }).ok, true);
const bad = checkGrounding({ body: "Streams are 40% faster and use 512 MB.", sources });
assert.equal(bad.ok, false);
assert.deepEqual(bad.unverified.sort(), ["40", "512"]);
const dead = checkGrounding({ body: "Streams buffer up to 16 KB by default.", sources: [{ url: "https://x.test/a", text: "" }] });
assert.equal(dead.ok, false);
assert.deepEqual(dead.deadSources, ["https://x.test/a"]);
assert.equal(checkGrounding({ body: "```js\nconst n = 512;\n```\nStreams buffer up to 16 KB.", sources }).ok, true);

// --- a long page keeps the numbers past the old 6000-char cut (nodejs.org/api/stream.html) ---
const longPage = "<p>" + "Filler paragraph about streams. ".repeat(400) + "</p><p>The default highWaterMark is 16384 bytes.</p>";
const longText = extractPageText(longPage);
assert.ok(longText.includes("16384"), "numbers deep in a long page must survive extraction");
assert.equal(checkGrounding({ body: "The default highWaterMark is 16384 bytes.", sources: [{ url: "https://nodejs.org/api/stream.html", text: longText }] }).ok, true);

console.log("grounding-selfcheck: ok");
