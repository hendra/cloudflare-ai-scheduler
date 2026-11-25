// Assert-based self-check for scripts/grounding.mjs (offline; no framework).
// Run: node scripts/grounding-selfcheck.mjs
import assert from "node:assert/strict";

const { numbersIn, riskyNumbers, proseOnly, extractPageText, fetchSourceText, checkGrounding, isCitationUrl } =
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

// --- regression: every common fence style and inline-code form hides its numbers ---
for (const md of [
  "~~~js\nconst n = 512;\n~~~",
  "````md\n```js\nconst n = 512;\n```\n````",
  "- step\n  ```bash\n  curl -d 512\n  ```",
  "    const n = 512;",
  "```js\nconst n = 512;",
  "Use ``x = 512`` here.",
]) {
  assert.deepEqual(riskyNumbers(proseOnly(md)), [], JSON.stringify(md));
}
assert.deepEqual(riskyNumbers(proseOnly("It buffers 512 MB.")), ["512"], "plain prose still counts");

// --- regression: a currency figure the source states verbatim is grounded ---
for (const [body, source] of [
  ["The company raised $1.5 million.", "The company raised $1.5 million in seed."],
  ["Dana Rp 1,5 miliar terkumpul.", "Dana Rp 1,5 miliar terkumpul."],
  ["It raised $2 billion.", "It raised $2 billion."],
  ["A $1.5M round.", "A $1.5M round."],
]) {
  const src = [{ url: "https://a.test/funding", text: source + " " + "Filler text about the round. ".repeat(10) }];
  assert.deepEqual(checkGrounding({ body, sources: src }).unverified, [], body);
}
assert.deepEqual(checkGrounding({ body: "It raised $9 million.", sources: [{ url: "https://a.test/f", text: "It raised $2 million. " + "Filler. ".repeat(40) }] }).unverified, ["9000000"]);

// --- a version prefix the source spells in full is grounded; an unrelated number is not ---
const verSrc = [{ url: "https://nodejs.org/api/", text: "Requires Node.js 20.11.1 or newer. " + "Filler text here. ".repeat(20) }];
assert.deepEqual(checkGrounding({ body: "Run it on Node 20.", sources: verSrc }).unverified, []);
assert.deepEqual(checkGrounding({ body: "Upgrade to Rails 7.1.", sources: [{ url: "https://a.test/r", text: "Rails 7.1.2 released. " + "Filler text here. ".repeat(20) }] }).unverified, []);
assert.deepEqual(checkGrounding({ body: "Use 33 workers.", sources: verSrc }).unverified, ["33"], "an unrelated number stays unverified");

// --- a page whose text sits in bare <div>s is readable, not dead (medium.com style) ---
const divPage = "<div><div>" + "An article paragraph with real words in it. ".repeat(10) + "</div></div>";
assert.ok(extractPageText(divPage).includes("article paragraph"), "div-only pages must yield text");

// --- nested <div> soup must not truncate a page's structured text (nodejs.org regression) ---
const nested = "<div><div>" + "<p>The default highWaterMark is 16384 bytes.</p>" + "<p>" + "Filler text here. ".repeat(20) + "</p></div></div>";
const nestedText = extractPageText(nested);
assert.ok(nestedText.includes("16384"), "nested divs must not cut structured text");

// --- a version prefix must not license a fabricated percentage or measurement ---
for (const [body, source, want] of [
  ["Deploys are 7% faster.", "Rails 7.1.2 released today.", ["7"]],
  ["3% faster", "Python 3.12 released.", ["3"]],
  ["Latency fell 45%.", "Latency fell 45.2% last quarter.", ["45"]],
  ["We hit 99% uptime.", "It measured 99.9% uptime.", ["99"]],
  ["Saved 20 days.", "Requires Node 20.11.1.", ["20"]],
  ["It needs 19 GB.", "Plans start at $19.99/mo.", ["19"]],
]) {
  const src = [{ url: "https://a.test/x", text: source + " " + "Filler text here. ".repeat(20) }];
  assert.deepEqual(checkGrounding({ body, sources: src }).unverified, want, body);
}
assert.deepEqual(checkGrounding({ body: "Run it on Node 20.", sources: [{ url: "https://a.test/x", text: "Requires Node.js 20.11.1. " + "Filler text here. ".repeat(20) }] }).unverified, [], "the version case still works");

// --- indented list continuations and single stray backticks must not blind the gate ---
assert.deepEqual(riskyNumbers(proseOnly("- Configure the pool:\n    - 4096 sockets per worker\n    - 45 ms p99 latency")), ["4096", "45", "99"]);
const strayTicks = "Set `limit` in `config.json` and restart with `node app.\n\nThe pool then opens 4096 sockets.\n\nAnother flag `workers` applies here.";
assert.deepEqual(riskyNumbers(proseOnly(strayTicks)), ["4096"], "a stray backtick must not delete the rest of the document");

// --- a fence opened and closed on one line hides only that line ---
assert.deepEqual(riskyNumbers(proseOnly("```js const n = 512; ```\nThen it opens 4096 sockets.")), ["4096"]);

// --- abbreviated currency ($1.5M, Rp 1,5 M) is the same figure as the spelled-out source ---
for (const [body, source] of [
  ["It raised $1.5M.", "It raised $1.5 million."],
  ["Dana Rp 1,5 T terkumpul.", "Dana Rp 1,5 triliun terkumpul."],
  ["A $250K round.", "A $250 thousand round."],
]) {
  const src = [{ url: "https://a.test/f", text: source + " " + "Filler text here. ".repeat(20) }];
  assert.deepEqual(checkGrounding({ body, sources: src }).unverified, [], body);
}

// --- an SI unit is not a scale word: "300 m" must never license "300 million" ---
for (const [body, source, want] of [
  ["The crater formed 300 million years ago.", "The crater rim is 300 m high.", ["300000000"]],
  ["The probe sent 20 million images.", "The dish is 20 m wide.", ["20000000"]],
  ["It is 5 trillion tonnes.", "The rod is 5 t.", ["5000000000000"]],
]) {
  const src = [{ url: "https://a.test/x", text: source + " " + "Filler text here. ".repeat(20) }];
  assert.deepEqual(checkGrounding({ body, sources: src }).unverified, want, body);
}
assert.deepEqual([...numbersIn("300 m high", { keepRaw: false })], ["300"], "metres are not millions");
assert.deepEqual([...numbersIn("$1.5M", { keepRaw: false })], ["1500000"], "currency short form still scales");

// --- a version mention licenses only itself, not a percentage of the same value ---
for (const [body, source, want] of [
  ["Node 20 is current. Our build is 20% faster.", "Node.js 20.11.1 is current.", ["20"]],
  ["Run it on Node 20. Memory use fell 20%.", "Node.js 20.11.1 is current.", ["20"]],
  ["Python 3 is out. It is 3% faster.", "Python 3.12 released.", ["3"]],
  ["We use Rails 7. Requests rose 7% this year.", "Rails 7.1.2 released.", ["7"]],
]) {
  const src = [{ url: "https://a.test/x", text: source + " " + "Filler text here. ".repeat(20) }];
  assert.deepEqual(checkGrounding({ body, sources: src }).unverified, want, body);
}
assert.deepEqual(checkGrounding({ body: "Run it on Node 20.", sources: [{ url: "x", text: "Node.js 20.11.1 shipped. " + "Filler. ".repeat(40) }] }).unverified, [], "the plain version case still works");

// --- a word ending in go/v is not a version word ---
for (const body of ["Two years ago 20 teams migrated.", "The cargo 20 tonnes arrived.", "Chicago 20 startups joined."]) {
  const src = [{ url: "x", text: "Node.js 20.11.1 shipped. " + "Filler. ".repeat(40) }];
  assert.deepEqual(checkGrounding({ body, sources: src }).unverified, ["20"], body);
}

// --- nested ordered lists and deeper indents are prose, not code ---
assert.deepEqual(riskyNumbers(proseOnly("- Raise the pool:\n    1. open 4096 sockets")), ["4096"]);
assert.deepEqual(riskyNumbers(proseOnly("- Tunables:\n        - 4096 sockets per worker")), ["4096"]);
assert.deepEqual(riskyNumbers(proseOnly("    const n = 512;")), [], "a real indented code block is still code");

// --- uppercase K/M/B/T without a currency symbol must still be checked ---
for (const body of ["It handles 500 M requests.", "Temperature is 300 K.", "Magnetic field is 15 T."]) {
  assert.ok(riskyNumbers(body).length > 0, body);
}

// --- version mention licenses ONLY if EVERY occurrence in the prose is a version ---
const vSrc = [{ url: "x", text: "Node.js 20.11.1 shipped. " + "Filler text. ".repeat(40) }];
for (const body of [
  "Node 20 is current. Latency is 20 ms.",
  "Node 20 is current. Needs 20 GB RAM.",
  "Node 20 is current. Handles 20 requests.",
  "Node 20 is current. It is 20 percent faster.",
  "Node 20 is current. Hosting is $20.",
]) {
  assert.deepEqual(checkGrounding({ body, sources: vSrc }).unverified, ["20"], body);
}
assert.deepEqual(checkGrounding({ body: "Node 20 is current. Built on Node 20.", sources: vSrc }).unverified, [], "two version mentions stay grounded");

console.log("grounding-selfcheck: ok");

// --- isCitationUrl: example hostnames are not citations, public hosts are ---
for (const u of [
  "http://rails_app",
  "http://rails_backend",
  "http://fastapi_backend",
  "http://$upstream",
  "http://$upstream/health",
  "https://$host$request_uri",
  "http://localhost/health",
  "http://localhost:3000/profile",
  "http://unix:/var/www/myapp/shared/tmp/sockets/puma.sock",
  "http://127.0.0.1:8000",
  "https://kubernetes.default.svc",
  "https://svc.cluster.local/x",
  "http://api.local/x",
  "http://intranet.internal/x",
  "ftp://example.com/x",
  "not a url",
  "",
  null,
]) {
  assert.equal(isCitationUrl(u), false, `${u} must not be a citation`);
}
for (const u of [
  "https://install.opensre.com",
  "https://download.pytorch.org/whl/cu122",
  "https://nodejs.org/api/stream.html",
  "https://a.test/doc",
  "http://example.com/x",
]) {
  assert.equal(isCitationUrl(u), true, `${u} must be a citation`);
}

// --- a number that is only ever a port is not a factual claim ---
assert.deepEqual(riskyNumbers("It listens on :3000 in development."), []);
assert.deepEqual(riskyNumbers("Expose port 80 and port 443."), []);
assert.deepEqual(riskyNumbers("Proxy to localhost:3000."), []);
assert.deepEqual(riskyNumbers("It handles 3000 requests per second."), ["3000"], "a count is not a port");
assert.deepEqual(riskyNumbers("It is 80% faster."), ["80"], "a percentage is not a port");
assert.deepEqual(riskyNumbers("Run on :3000, then load 3000 rows."), ["3000"], "one non-port use keeps it risky");
assert.deepEqual(riskyNumbers("Open :3000 and :3000 again."), [], "every occurrence a port is exempt");
