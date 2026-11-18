# Grounded Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No invented number or proper noun can reach a published blog article or IG Reel; anything that cannot be grounded is skipped with exit 0 and a Slack note.

**Architecture:** One new zero-dependency module, `scripts/grounding.mjs`, holds the deterministic checks (number normalisation, prose extraction, source fetching, `checkGrounding`). The three blog writers call it after `validateAeoGeo` passes and before cover/build; a failure triggers one repair call carrying the source texts, then a clean skip. IG Reel gains a soft proper-noun check inside the existing `check_story` repair loop.

**Tech Stack:** Node 20 ESM (no deps), Python 3 stdlib. Assert-based self-checks, no framework.

**Spec:** `docs/superpowers/specs/2026-11-18-grounded-content-design.md`

## Global Constraints

- No new npm or pip dependency; Node stdlib + `fetch`, Python stdlib only.
- No new D1 table, queue, provider, or config value.
- Skip = `process.exit(0)` after a Slack note; never a non-zero exit, never a commit/PR/ledger row.
- Grounding is bypassed when `AI_STUB` is truthy, and runs under `DRY_RUN`.
- IG Reel tips are unchanged: no source, existing `tip_rule_errors` rules stay.
- Verification for every task: `npm run typecheck` (untouched, must stay green) plus that task's self-check.
- Commit style: `feat: …` / `fix: …`, one commit per task, never on `main`.

## Review Focus

- A cited page that returns 200 with an HTML shell and no body text must count as a dead source, not a passing one (`fetchSourceText`).
- A number inside a fenced code block or inline code must never be reported as invented (`proseOnly`).
- "8.700" (Indonesian thousands) and "1,5 miliar" must not be licensed by an unrelated "1.5 million" in a source; scale words must normalise (`numbersIn` keepRaw=false).
- An article whose only citation is an RFC/spec page (body inside `<pre>`) must pass the dead-link check.
- A skipped article must not leave a commit, branch, PR or ledger row behind.

---

### Task 1: `numbersIn` and `riskyNumbers` in `scripts/grounding.mjs`

**Files:**
- Create: `scripts/grounding.mjs`
- Create: `scripts/grounding-selfcheck.mjs`
- Modify: `package.json` (add `grounding:selfcheck` script next to `aeo:selfcheck`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `numbersIn(text: string, { keepRaw = true } = {}) -> Set<string>` — normalised decimal strings.
  - `riskyNumbers(text: string) -> string[]` — sorted, deduped risky numbers.
  - `SCALES` (internal) covering `ribu|thousand|juta|million|miliar|milyar|billion|triliun|trillion`.

- [ ] **Step 1: Write the failing test**

Create `scripts/grounding-selfcheck.mjs` with an assert header and only the number cases:

```js
// Assert-based self-check for scripts/grounding.mjs (offline; no framework).
// Run: node scripts/grounding-selfcheck.mjs
import assert from "node:assert/strict";

const { numbersIn, riskyNumbers } = await import("./grounding.mjs");

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

console.log("grounding-selfcheck: numbers ok");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/grounding-selfcheck.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `./grounding.mjs`.

- [ ] **Step 3: Implement the module**

Create `scripts/grounding.mjs` exporting `numbersIn` and `riskyNumbers`. Port `numbers_in` from `scripts/ig_reel/story.py:198-215` (same `_norm_number` rule: a separator followed by exactly three digits is a thousands separator, otherwise a decimal mark; with `keepRaw=false` a scaled number yields only its scaled value). `riskyNumbers` runs `numbersIn(text, { keepRaw: false })` plus regex passes for percentages (`/\d+(?:[.,]\d+)?\s*%/`), currency (`/(?:Rp\.?|\$|USD|EUR)\s?\d[\d.,]*/i`) and `vX.Y` / dotted version tokens, drops four-digit integers in 1990–2100, drops integers below 10 with no decimal part, and returns the sorted unique list.

- [ ] **Step 4: Run the self-check to verify it passes**

Run: `node scripts/grounding-selfcheck.mjs`
Expected: `grounding-selfcheck: numbers ok`

- [ ] **Step 5: Wire the npm script**

Add `"grounding:selfcheck": "node scripts/grounding-selfcheck.mjs"` to `package.json` scripts. Run `npm run grounding:selfcheck` — same output.

- [ ] **Step 6: Commit**

```bash
git add scripts/grounding.mjs scripts/grounding-selfcheck.mjs package.json
git commit -m "feat: add number grounding helpers"
```

---

### Task 2: `proseOnly` and `fetchSourceText`

**Files:**
- Modify: `scripts/grounding.mjs`
- Modify: `scripts/grounding-selfcheck.mjs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `proseOnly(markdown: string) -> string`
  - `extractPageText(html: string) -> string` (≤6000 chars)
  - `fetchSourceText(url: string) -> Promise<{ ok: boolean, status: number, text: string }>` — `ok` requires a 2xx status **and** ≥200 chars of `extractPageText`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/grounding-selfcheck.mjs`:

```js
const { proseOnly, extractPageText } = await import("./grounding.mjs");

// --- proseOnly: code and URLs are not claims ---
const md = [
  "Set memory to `--max-old-space-size=4096` and see 4096 MB.",
  "```bash",
  "curl -X POST https://api.example.com/v2/items?limit=500",
  "```",
  "Then read [the docs](https://nodejs.org/api/stream.html#api-12345).",
].join("\n");
const prose = proseOnly(md);
assert.ok(!prose.includes("4096"), "inline/fenced code must be stripped");
assert.ok(!prose.includes("example.com"), "link URLs must be stripped");
assert.ok(prose.includes("the docs"), "link text stays");

// --- extractPageText: RFC-style <pre> bodies count ---
const html = '<nav>skip me</nav><pre>1.  Introduction\n   The value MUST be 4096.</pre><p>Also 200.</p>';
const text = extractPageText(html);
assert.ok(text.includes("4096") && text.includes("200"));
assert.ok(!text.includes("skip me"), "nav stripped");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/grounding-selfcheck.mjs`
Expected: FAIL — `proseOnly` is not a function.

- [ ] **Step 3: Implement both helpers**

`proseOnly`: drop frontmatter, drop fenced blocks, drop inline code, replace `[text](url)` with `text`, drop bare `https?://\S+` and autolinks, unescape nothing else. `extractPageText`: strip `script|style|nav|header|footer|aside|noscript|svg` with their contents, then join text from `p, li, pre, td, dd, blockquote` (deliberately wider than `story.py`'s `<p>`-only rule — RFC/spec bodies live in `<pre>`), collapse whitespace, cap 6000 chars. `fetchSourceText`: `fetch` with a browser UA, 25 s `AbortSignal.timeout`, `redirect: "follow"`, reject non-`text/html` content types, read at most 2 MB, and only accept `http:`/`https:` URLs.

- [ ] **Step 4: Run the self-check to verify it passes**

Run: `node scripts/grounding-selfcheck.mjs`
Expected: `grounding-selfcheck: numbers ok` then `grounding-selfcheck: prose ok`.

- [ ] **Step 5: Commit**

```bash
git add scripts/grounding.mjs scripts/grounding-selfcheck.mjs
git commit -m "feat: add prose extraction and source fetching"
```

---

### Task 3: `checkGrounding` and the blog repair prompt

**Files:**
- Modify: `scripts/grounding.mjs`
- Modify: `scripts/grounding-selfcheck.mjs`
- Create: `scripts/blog-grounding.mjs`
- Create: `scripts/blog-grounding-selfcheck.mjs`
- Modify: `package.json` (add `blog:grounding:selfcheck`)

**Interfaces:**
- Consumes: `proseOnly`, `riskyNumbers`, `fetchSourceText`, `numbersIn`.
- Produces:
  - `checkGrounding({ body, sources }) -> { ok, errs, unverified, deadSources }` where `sources: [{ url, text }]`.
  - `blog-grounding.mjs` exporting `collectSources(links: string[]) -> Promise<{ sources, deadSources }>` and `groundArticle({ article, links, signalUrl, callModel, aiStub }) -> Promise<{ ok: true, sources } | { ok: false, unverified, deadSources }>`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/grounding-selfcheck.mjs`:

```js
const { checkGrounding } = await import("./grounding.mjs");
const sources = [{ url: "https://nodejs.org/api/stream.html", text: "Streams buffer up to 16 KB by default. Released in 2026." }];

// A grounded body passes.
assert.equal(checkGrounding({ body: "Streams buffer up to 16 KB by default.", sources }).ok, true);
// An invented benchmark fails and names the number.
const bad = checkGrounding({ body: "Streams are 40% faster and use 512 MB.", sources });
assert.equal(bad.ok, false);
assert.deepEqual(bad.unverified.sort(), ["40", "512"]);
// A dead source is an error even when the prose is clean.
const dead = checkGrounding({ body: "Streams buffer up to 16 KB by default.", sources: [{ url: "https://x.test/a", text: "" }] });
assert.equal(dead.ok, false);
assert.deepEqual(dead.deadSources, ["https://x.test/a"]);
// Code blocks are not claims.
assert.equal(checkGrounding({ body: "```js\nconst n = 512;\n```\nStreams buffer up to 16 KB.", sources }).ok, true);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/grounding-selfcheck.mjs`
Expected: FAIL — `checkGrounding` is not a function.

- [ ] **Step 3: Implement `checkGrounding`**

Implement in `scripts/grounding.mjs`: `deadSources` = every source whose `text.trim().length < 200`; `allowed` = union of `numbersIn(text, { keepRaw: false })` over non-dead sources; `unverified` = `riskyNumbers(proseOnly(body))` minus `allowed`; `errs` = one line per dead source plus one line per unverified number; `ok = errs.length === 0`.

- [ ] **Step 4: Run the self-check to verify it passes**

Run: `npm run grounding:selfcheck`
Expected: three `ok` lines, no assertion error.

- [ ] **Step 5: Write the failing blog-glue test**

Create `scripts/blog-grounding-selfcheck.mjs`:

```js
// Assert-based self-check for scripts/blog-grounding.mjs (offline; fetch is stubbed).
import assert from "node:assert/strict";
const { groundArticle } = await import("./blog-grounding.mjs");

const article = (body) => ({ title: "t", slug: "s", description: "d", keyword: "k", body });
const fakeFetch = async (url) => ({ ok: true, status: 200, text: `Docs for ${url}. ` + "Filler paragraph. ".repeat(20) + "Limit is 512 MB." });

// Grounded on first try: no repair call.
let calls = 0;
const pass = await groundArticle({ article: article("Limit is 512 MB."), links: ["https://a.test/doc"], signalUrl: null, callModel: async () => { calls++; return ""; }, fetchSourceText: fakeFetch });
assert.equal(pass.ok, true);
assert.equal(calls, 0);

// Invented number: one repair call receives the source text, then passes.
let prompts = [];
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

console.log("blog-grounding-selfcheck: ok");
```

- [ ] **Step 6: Run it to verify it fails**

Run: `node scripts/blog-grounding-selfcheck.mjs`
Expected: FAIL — cannot find `./blog-grounding.mjs`.

- [ ] **Step 7: Implement `scripts/blog-grounding.mjs`**

Export `collectSources(links, fetcher = fetchSourceText)` → fetches each link sequentially, returns `{ sources, deadSources }`. Export `groundArticle({ article, links, signalUrl, callModel, fetchSourceText })`: build sources from `links` plus `signalUrl` when it fetches (a failing signal is dropped silently, never a dead source); run `checkGrounding`; on failure call `callModel` once with a prompt that lists `unverified` and `deadSources`, embeds each source as `### <url>\n<text>`, and asks for the corrected body only; re-run `checkGrounding` on the returned body; return the shape in Interfaces. Never throws for grounding failures.

- [ ] **Step 8: Run both self-checks**

Run: `node scripts/blog-grounding-selfcheck.mjs && npm run grounding:selfcheck`
Expected: `blog-grounding-selfcheck: ok` and three `ok` lines.

- [ ] **Step 9: Add the npm script and commit**

Add `"blog:grounding:selfcheck": "node scripts/blog-grounding-selfcheck.mjs"`.

```bash
git add scripts/grounding.mjs scripts/grounding-selfcheck.mjs scripts/blog-grounding.mjs scripts/blog-grounding-selfcheck.mjs package.json
git commit -m "feat: add blog grounding gate"
```

---

### Task 4: Wire the gate into `fullstackweb-blog-writer.mjs`

**Files:**
- Modify: `scripts/fullstackweb-blog-writer.mjs` (body prompt ~406-427, validation block ~450-495, link check ~497-501, Slack/fail ~108-130)
- Modify: `scripts/blog-aeo.mjs:410` (remove the 15-link cap)

**Interfaces:**
- Consumes: `groundArticle` from `scripts/blog-grounding.mjs`; `fetchSourceText` from `scripts/grounding.mjs`.
- Produces: nothing new; `validateAeoGeo` keeps its signature but `links` is no longer truncated.

- [ ] **Step 1: Lift the link cap**

In `scripts/blog-aeo.mjs`, change `links: externalLinks.slice(0, 15)` to `links: externalLinks`. Run `npm run aeo:selfcheck` — must stay green.

- [ ] **Step 2: Feed the signal text into the body prompt**

In `makeBodyPrompt(a)`, accept the fetched signal text and append:

```
Source material (facts you may state — do not state facts outside it as fact):
<signal text, 6000 chars max>
```

Fetch it once before the body loop with `fetchSourceText(chosenSignal?.url)`, and use `""` when the fetch fails.

- [ ] **Step 3: Replace the HEAD loop with the grounding gate**

Delete the `headOk` dead-link loop. After `validateAeoGeo` passes and before cover generation, call `groundArticle({ article, links: v.links, signalUrl: chosenSignal?.url, callModel })`. On `ok: false`, post one Slack note (`⚠️ _FullstackWeb.dev article skipped — unverifiable facts:_ <title> · numbers: … · dead sources: …`), then `process.exit(0)`. On `ok: true`, assign the returned body back to `article.body` and re-run `validateAeoGeo` once; if that fails, `await fail(...)` as today.

- [ ] **Step 4: Skip grounding under `AI_STUB`**

Guard the gate with `if (!AI_STUB)`, so the stub path keeps its current behaviour.

- [ ] **Step 5: Verify**

Run: `node --check scripts/fullstackweb-blog-writer.mjs && npm run typecheck && npm run aeo:selfcheck && npm run blog:grounding:selfcheck`
Expected: all silent/pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/fullstackweb-blog-writer.mjs scripts/blog-aeo.mjs
git commit -m "feat: ground fullstackweb articles on fetched sources"
```

---

### Task 5: Same wiring for `railsdev-blog-writer.mjs` and `inasoft-blog-writer.mjs`

**Files:**
- Modify: `scripts/railsdev-blog-writer.mjs` (body prompt ~267-273, validation ~430-470, link check, Slack note)
- Modify: `scripts/inasoft-blog-writer.mjs` (body prompt ~360, validation, link check, Slack note)

**Interfaces:**
- Consumes: identical to Task 4.
- Produces: nothing new.

- [ ] **Step 1: Repeat Task 4 steps 2-4 in `railsdev-blog-writer.mjs`**

Same three edits: signal text in the body prompt, `groundArticle` after validation and before cover, skip-with-Slack on failure, `AI_STUB` guard. Keep the existing `dead` count out of the PR body text (rewrite that line to `[x] N external sources fetched and grounded`).

- [ ] **Step 2: Verify railsdev**

Run: `node --check scripts/railsdev-blog-writer.mjs && npm run typecheck`
Expected: silent.

- [ ] **Step 3: Repeat in `inasoft-blog-writer.mjs`**

Same three edits. Slack note text in Indonesian, matching the file's existing note language.

- [ ] **Step 4: Verify inasoft**

Run: `node --check scripts/inasoft-blog-writer.mjs && npm run typecheck`
Expected: silent.

- [ ] **Step 5: Commit**

```bash
git add scripts/railsdev-blog-writer.mjs scripts/inasoft-blog-writer.mjs
git commit -m "feat: ground railsdev and inasoft articles on fetched sources"
```

---

### Task 6: Soft proper-noun check for IG Reel news

**Files:**
- Modify: `scripts/ig_reel/story.py` (`check_story`, after the language block ~309-330)
- Modify: `scripts/ig_reel/selfcheck.py`
- Modify: `scripts/ig_reel_daily.py` (`write_story` repair prompt ~594-597)

**Interfaces:**
- Consumes: existing `check_story(data, article_text, extra_allowed=(), mode="news")`.
- Produces: `proper_noun_errors(data, article_text) -> list[str]` in `story.py`; `check_story` returns the same `(hard, soft)` tuple, with proper-noun findings appended to **soft** so the existing one-repair loop handles them.

- [ ] **Step 1: Write the failing test**

Append to `scripts/ig_reel/selfcheck.py`:

```python
# --- proper nouns: fabricated names are reported, real ones pass ---
import copy as _copy
pn = _copy.deepcopy(STORY)
pn["beats"][1]["text"] = "Teleskop Zorblax menemukan oksigen di planet itu."
errs = proper_noun_errors(pn, ARTICLE)
assert any("Zorblax" in e for e in errs), errs

pn_ok = _copy.deepcopy(STORY)
pn_ok["beats"][1]["text"] = "Teleskop James Webb menemukan oksigen di planet itu."
assert proper_noun_errors(pn_ok, ARTICLE + " The James Webb Telescope found oxygen.") == []

# First token of a field is exempt (Indonesian sentence starters, translated names).
pn_first = _copy.deepcopy(STORY)
pn_first["hook"] = "Bumi makin panas"
assert proper_noun_errors(pn_first, ARTICLE) == []

# Captions and hashtags are not scanned.
pn_cap = _copy.deepcopy(STORY)
pn_cap["caption"]["body"] = "Menurut NASA dan ESA, ini penting."
assert proper_noun_errors(pn_cap, ARTICLE) == []
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 scripts/ig_reel/selfcheck.py`
Expected: `NameError: proper_noun_errors`.

- [ ] **Step 3: Implement `proper_noun_errors` and wire it as soft**

In `story.py`, add `proper_noun_errors(data, article_text)` scanning only `hook` and each beat's `text`/`highlight`. For each field, skip the first whitespace token; for every remaining token that starts uppercase and contains a letter, ignore tokens with digits, and report it when `token.lower()` is not a substring of `article_text.lower()`. Return `["proper noun not found in the article text: X, Y"]` per field or `[]`.

Wire it into `check_story` **after** the language block, news mode only: the first call reports findings as **soft** entries; the repair loop in `write_story`/`find_news_story` therefore retries once, and only a second failure raises `RuntimeError` (existing behaviour — no new control flow).

- [ ] **Step 4: Add the repair instruction**

In `ig_reel_daily.py:write_story`, extend the `fix` prompt with one line: `Ganti nama diri yang tidak ada di artikel dengan nama yang ada di artikel, atau tulis ulang kalimatnya tanpa nama itu (mis. "planet kita").`

- [ ] **Step 5: Run the self-check**

Run: `python3 scripts/ig_reel/selfcheck.py`
Expected: all asserts pass, no `NameError`.

- [ ] **Step 6: Commit**

```bash
git add scripts/ig_reel/story.py scripts/ig_reel/selfcheck.py scripts/ig_reel_daily.py
git commit -m "feat: flag invented proper nouns in reel stories"
```

---

### Task 7: Documentation and end-to-end dry runs

**Files:**
- Modify: `AGENTS.md` (Architecture bullet for grounding; gotchas if any)
- Modify: `docs/status.md` (self-check list, pipeline behaviour on skip)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Update `AGENTS.md`**

Add one Architecture bullet: blog writers ground every risky number on fetched cited pages + the chosen signal page via `scripts/grounding.mjs` / `scripts/blog-grounding.mjs`; a failure is one repair then a Slack note and `exit 0` (nothing published). Note the new self-checks next to the existing ones.

- [ ] **Step 2: Update `docs/status.md`**

Record the new self-checks (`npm run grounding:selfcheck`, `npm run blog:grounding:selfcheck`) and that a skipped article appears as a Slack note, not a failure.

- [ ] **Step 3: Run every check**

Run: `npm run typecheck && npm run aeo:selfcheck && npm run published:selfcheck && npm run grounding:selfcheck && npm run blog:grounding:selfcheck && python3 scripts/ig_reel/selfcheck.py`
Expected: all pass.

- [ ] **Step 4: Dry-run each blog workflow**

Dispatch each of the three blog workflows with `dry_run=true`. Expected: either a normal dry-run print or a clean skip with a Slack note — never a non-zero exit.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md docs/status.md
git commit -m "docs: record grounding gate and self-checks"
```
