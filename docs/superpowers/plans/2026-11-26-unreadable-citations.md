# Unreadable citations stop discarding grounded articles — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the blog grounding gate from discarding a fully grounded article over a citation the fetcher merely cannot read, while keeping a wrong citation (404 / network failure) fatal.

**Architecture:** `fetchSourceText` learns to read text-bearing content types and reports *why* it failed (`status`/`network`/`blocked`/`type`/`empty`). `groundArticle` splits those into `deadSources` (fatal) and `unreadable` (warning) and requires at least one readable source. `checkGrounding` is untouched. One separate helper change makes port lists stop counting as unverified facts.

**Tech Stack:** Node 20 ESM, zero dependencies, assert-based self-checks (`node:assert/strict`).

**Spec:** `docs/superpowers/specs/2026-11-26-unreadable-citations-design.md`

## Global Constraints

- Zero new dependencies. No test framework: a self-check is an `assert` script run by `node`.
- `checkGrounding` behaviour must not change.
- Text surface per source is capped at the existing 200 000 chars for both HTML and non-HTML.
- Fatal: 4xx other than 401/403/429, and network/DNS/timeout. Non-fatal: 401/403/429, any 5xx, an unreadable content type, or under `MIN_SOURCE_CHARS`.
- Never commit to `main`; branch + PR.

## Review Focus

- A 404 the model invented must still block. A 403 from a real site must not.
- An article whose every citation is unreadable must not publish with nothing verified.
- A shell script / JSON body must not get a bigger grounding surface than an HTML page.
- `port 3000 and 5000 requests` keeps `5000` a claim while `ports 80 dan 443` exempts both.
- `rails_app:3000/health` stays a port (`grounding-selfcheck.mjs:266`).

---

### Task 1: `fetchSourceText` reads text and reports why it failed

**Files:**
- Modify: `scripts/grounding.mjs:214-284`
- Test: `scripts/grounding-selfcheck.mjs:44-57`

**Interfaces:**
- Produces: `fetchSourceText(url, { timeout }) -> Promise<{ ok, status, text, reason }>`; `reason` is `null` on success, else `"status" | "network" | "blocked" | "type" | "empty"`.

- [ ] **Step 1: Write the failing tests**

In `scripts/grounding-selfcheck.mjs`, replace line 53-54 (`non-HTML is refused`) and add after it, before `globalThis.fetch = realFetch;`:

```js
globalThis.fetch = stubFetch("#!/bin/sh\n" + "# installer steps. ".repeat(20), "application/x-sh");
const sh = await fetchSourceText("https://a.test/install.sh");
assert.equal(sh.ok, true, "a shell installer is a readable source");
assert.ok(sh.text.startsWith("#!/bin/sh"), "non-HTML is kept verbatim, not tag-stripped");
globalThis.fetch = stubFetch("Plain text docs. ".repeat(20), "text/plain");
assert.equal((await fetchSourceText("https://a.test/readme")).ok, true, "text/plain is readable");
globalThis.fetch = stubFetch(JSON.stringify({ ok: 1 }), "application/json");
assert.equal((await fetchSourceText("https://a.test/api")).reason, "empty", "a short JSON body is empty");
globalThis.fetch = stubFetch(longHtml, "text/html", 404);
assert.equal((await fetchSourceText("https://a.test/missing")).reason, "status");
globalThis.fetch = stubFetch(longHtml, "text/html", 403);
assert.equal((await fetchSourceText("https://a.test/private")).reason, "blocked");
globalThis.fetch = stubFetch(longHtml, "text/html", 503);
assert.equal((await fetchSourceText("https://a.test/down")).reason, "blocked", "a transient 5xx is not a bad citation");
globalThis.fetch = stubFetch("%PDF-1.7 binary", "application/pdf");
assert.equal((await fetchSourceText("https://a.test/paper.pdf")).reason, "type");
globalThis.fetch = stubFetch(longHtml);
assert.equal((await fetchSourceText("https://a.test/doc")).reason, null, "success has no reason");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/grounding-selfcheck.mjs`
Expected: FAIL — the `application/x-sh` case returns `ok: false`.

- [ ] **Step 3: Implement**

In `scripts/grounding.mjs`, add above `fetchSourceText`:

```js
const TEXT_TYPES = /^(?:text\/|application\/(?:x-sh|json|xml|javascript|xhtml\+xml|ld\+json))/i;
const BLOCKED_STATUS = new Set([401, 403, 429]);
```

Then: `fail(reason, status = 0) => ({ ok: false, status, text: "", reason })`, with reasons — invalid URL or non-http scheme `"network"`; non-2xx `BLOCKED_STATUS.has(s) || s >= 500 ? "blocked" : "status"`; content type neither HTML nor `TEXT_TYPES` `"type"`; text under `MIN_SOURCE_CHARS` `"empty"`; the `catch` `"network"`. Extraction branches: HTML → `extractPageText(html)`, otherwise `html.slice(0, 200_000)` (tag-stripping a script corrupts it; the cap matches `extractPageText`). Success returns `reason: null`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/grounding-selfcheck.mjs`
Expected: exit 0, no assertion output.

- [ ] **Step 5: Commit**

```bash
git add scripts/grounding.mjs scripts/grounding-selfcheck.mjs
git commit -m "feat(grounding): read text-bearing citations and report the failure reason"
```

---

### Task 2: port lists are ports

**Files:**
- Modify: `scripts/grounding.mjs:100-113`
- Test: `scripts/grounding-selfcheck.mjs:260-266`

**Interfaces:**
- Consumes: `occurrencesOf(n)` already yields `{ before, after }`.
- Produces: nothing new; `riskyNumbers` keeps its signature.

- [ ] **Step 1: Write the failing tests**

Append after `scripts/grounding-selfcheck.mjs:266`:

```js
assert.deepEqual(riskyNumbers("Expose ports 80 dan 443."), [], "a port list is not a claim");
assert.deepEqual(riskyNumbers("EXPOSE 80 in the Dockerfile."), [], "EXPOSE is a port lead-in");
assert.deepEqual(riskyNumbers("Bind port: 80 on the host."), [], "port: is a port lead-in");
assert.deepEqual(riskyNumbers("Map port 8080 dan 80."), [], "the tail of a port list is a port");
assert.deepEqual(riskyNumbers("It handles port 3000 and 5000 requests."), ["5000"], "a word after it makes it a claim");
assert.deepEqual(riskyNumbers("It handled 3,000 requests."), ["3000"], "a count with no port lead-in stays a claim");
assert.deepEqual(riskyNumbers("40% faster on port 80."), ["40"], "a percentage beside a port stays a claim");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/grounding-selfcheck.mjs`
Expected: FAIL on the first new assertion — `ports 80 dan 443` yields `["443","80"]`.

- [ ] **Step 3: Implement**

Replace `isPort` in `scripts/grounding.mjs` so it reads `after` too:

```js
const PORT_LEAD_RE = /(?:\bports?\s*:?\s*|\bEXPOSE\s+)$/i;
// A number continuing a port list: "port 8080 dan ", "ports 80, ", "443, ".
const PORT_LIST_RE = /(?:\bports?\s*:?\s*|\bEXPOSE\s+|\d{1,5}\s*(?:,|\bdan\b|\band\b)\s*)$/i;
// A port ends the list: punctuation, a conjunction, or nothing. A word after it is a unit.
const PORT_TAIL_RE = /^\s*(?:$|[,;.:)]|\bdan\b|\band\b)/i;
const isPort = ({ before, after }) => {
  if (PORT_LEAD_RE.test(before)) return true;
  if (PORT_TAIL_RE.test(after) && PORT_LIST_RE.test(before)) return true;
  if (!/:$/.test(before)) return false;
  const label = before.slice(0, -1).match(/([^\s:/]*)$/)?.[1] ?? "";
  if (label === "") return true;
  return /[._]/.test(label) || label === "localhost";
};
```

`onlyPort` is unchanged. The explicit lead-in needs no tail check: the author named it a port, which is exactly the trust `port 80` gets today.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/grounding-selfcheck.mjs`
Expected: exit 0, including the pre-existing `Timeout:3000 ms`, `Ratio 1:3000` and `rails_app:3000/health` assertions.

- [ ] **Step 5: Commit**

```bash
git add scripts/grounding.mjs scripts/grounding-selfcheck.mjs
git commit -m "fix(grounding): treat port lists as ports, not unverified facts"
```

---

### Task 3: `groundArticle` separates dead citations from unreadable ones

**Files:**
- Modify: `scripts/blog-grounding.mjs:12-21`, `:42-99`
- Test: `scripts/blog-grounding-selfcheck.mjs`

**Interfaces:**
- Consumes: `fetchSourceText(...).reason` (Task 1).
- Produces: `collectSources(links, fetcher) -> Promise<{ sources, deadSources, unreadable }>`; `groundArticle(...)` result always carries `unreadable: string[]`, and `ok` is true only when `sources.length > 0`, `unverified` is empty and `deadSources` is empty.

- [ ] **Step 1: Write the failing tests**

In `scripts/blog-grounding-selfcheck.mjs`, give the three existing 404 stubs (`:55`, `:101`, `:111`, `:122`) a `reason: "status"` field, then append:

```js
const blockedFetch = (url) => (url.includes("blocked.test")
  ? { ok: false, status: 403, text: "", reason: "blocked" }
  : fakeFetch(url));

// A 403 is unreadable, not fatal: the grounded article ships and the link is reported.
const blockedOnly = await groundArticle({
  article: article("Limit is 512 MB."),
  links: ["https://a.test/doc", "https://blocked.test/x"],
  signalUrl: null, callModel: async () => "", fetchSourceText: blockedFetch,
});
assert.equal(blockedOnly.ok, true, "one unreadable citation must not discard a grounded article");
assert.deepEqual(blockedOnly.unreadable, ["https://blocked.test/x"]);

// ...but it still cannot ground the number it is cited for.
const blockedGround = await groundArticle({
  article: article("Limit is 999 MB."),
  links: ["https://a.test/doc", "https://blocked.test/x"],
  signalUrl: null, callModel: async () => "Limit is 999 MB.", fetchSourceText: blockedFetch,
});
assert.equal(blockedGround.ok, false);
assert.deepEqual(blockedGround.unverified, ["999"]);

// Nothing readable at all is not a pass, even with no risky number in the prose.
const nothingRead = await groundArticle({
  article: article("It shipped in 2026."),
  links: ["https://blocked.test/x"],
  signalUrl: null, callModel: async () => "",
  fetchSourceText: async () => ({ ok: false, status: 403, text: "", reason: "blocked" }),
});
assert.equal(nothingRead.ok, false, "no readable source means nothing was verified");
assert.deepEqual(nothingRead.unreadable, ["https://blocked.test/x"]);

// A 404 the model invented still blocks.
const invented = await groundArticle({
  article: article("Limit is 512 MB."),
  links: ["https://a.test/doc", "https://gone.test/x"],
  signalUrl: null, callModel: async () => "",
  fetchSourceText: async (url) => (url.includes("gone.test")
    ? { ok: false, status: 404, text: "", reason: "status" }
    : fakeFetch(url)),
});
assert.equal(invented.ok, false);
assert.deepEqual(invented.deadSources, ["https://gone.test/x"]);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/blog-grounding-selfcheck.mjs`
Expected: FAIL — `blockedOnly.ok` is `false`.

- [ ] **Step 3: Implement**

In `scripts/blog-grounding.mjs`:

- `collectSources`: route by `res.reason` — `"status"`/`"network"` → `deadSources`, `"blocked"`/`"type"`/`"empty"` → `unreadable`, `res.ok` → `sources`. Return all three.
- `groundArticle`: thread `unreadable` through the early return and `verdict`; success becomes `v.ok && dead.length === 0 && srcs.length > 0`; merge `extraUnreadable` from the repair round the same way `extraDead` merges. Every return carries `unreadable` (empty array when clean).

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/blog-grounding-selfcheck.mjs`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/blog-grounding.mjs scripts/blog-grounding-selfcheck.mjs
git commit -m "feat(blog-grounding): keep unreadable citations as warnings, not skips"
```

---

### Task 4: writers report unreadable citations and label the fatal list correctly

**Files:**
- Modify: `scripts/inasoft-blog-writer.mjs:541-554`, `scripts/railsdev-blog-writer.mjs:432-445`, `scripts/fullstackweb-blog-writer.mjs:679-692`, `scripts/hendranicholas-blog-writer.mjs:573-586`

**Interfaces:**
- Consumes: `groundArticle(...).unreadable` (Task 3).
- Produces: console output only.

- [ ] **Step 1: Add the warning line**

After each writer's `grounding ok — ${g.sources.length} source(s) read` line:

```js
if (g.unreadable.length) console.log(`::warning title=Unreadable citations::${g.unreadable.join(" | ")}`);
```

- [ ] **Step 2: Relabel the fatal list in the skip note**

`deadSources` now means 404 / network only.

- `inasoft-blog-writer.mjs:543`: `Sitasi yang tidak bisa dibaca:` → `Sitasi yang gagal diambil (404 / jaringan):`
- `railsdev-blog-writer.mjs:434`, `fullstackweb-blog-writer.mjs:681`, `hendranicholas-blog-writer.mjs:575`: `Unreadable citations:` → `Citations that could not be fetched (404 / network):`

- [ ] **Step 3: Verify the writers parse**

Run: `for f in inasoft railsdev fullstackweb hendranicholas; do node --check scripts/$f-blog-writer.mjs || exit 1; done`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/inasoft-blog-writer.mjs scripts/railsdev-blog-writer.mjs scripts/fullstackweb-blog-writer.mjs scripts/hendranicholas-blog-writer.mjs
git commit -m "feat(blogs): warn on unreadable citations, relabel the fatal list"
```

---

### Task 5: record the rule and run the full suite

**Files:**
- Modify: `docs/status.md` (entry 31)

- [ ] **Step 1: Update the status entry**

In `docs/status.md` entry 31, after the sentence about a live URL with no body counting as dead, add one sentence: a citation answering 401/403/429/5xx, carrying a content type with no readable text, or yielding under 200 chars is **unreadable** — logged as a warning and never fatal on its own — while 4xx other than those and network failures are **dead** and still skip the article; an article with no readable source at all is skipped regardless.

- [ ] **Step 2: Run the full suite**

```bash
npm run grounding:selfcheck && npm run blog:grounding:selfcheck && npm run aeo:selfcheck && npm run published:selfcheck && npm run topicmix:selfcheck && npm run typecheck
```

Expected: every script exits 0; `typecheck` prints nothing.

- [ ] **Step 3: Dispatch one dry run**

```bash
gh workflow run inasoft-blog-writer.yml -f dry_run=true
```

Expected: the run logs `grounding ok — N source(s) read` and ends in `=== DRY RUN — would open PR ===` or a clean skip note; a grounding skip must never list only unreadable citations.

- [ ] **Step 4: Commit**

```bash
git add docs/status.md
git commit -m "docs(status): record the unreadable-citation rule"
```
