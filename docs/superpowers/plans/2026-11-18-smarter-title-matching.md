# Smarter Title Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deduplication gate catch near-duplicate topics instead of letting them through, in both the Node blog writers and the Python IG Reel pipeline.

**Architecture:** Replace the Jaccard token comparison inside the two existing similarity predicates with a shared algorithm: light stemming plus a containment coefficient (`shared / min(|A|,|B|)`). One JSON fixture of expected verdicts is read by both self-checks, so the two language copies cannot drift.

**Tech Stack:** Node 20 ESM, zero dependencies; Python 3 standard library only.

**Spec:** `docs/superpowers/specs/2026-11-18-smarter-title-matching-design.md`

## Global Constraints

- Zero new dependencies in both languages.
- `normalizeTitle` (Node) and `normalize_title` (Python) behaviour must not change — they are also used as exact keys by `buildBlogHistory` / `buildBlogAvoidList`.
- Similarity thresholds: `shared >= 2` AND `shared / min(|A|,|B|) >= 0.7`.
- Stopwords: `{the, and, dan, yang}`. Tokens shorter than 3 chars are dropped.
- Stem rule order is fixed: plural → `ing`/`ed` → `ation`/`ion` → trailing `e`.
- Every existing assertion in both self-checks must keep passing unchanged.
- No caller signatures change.

## Review Focus

- **Paraphrase with no shared vocabulary** (`Cutting Rails Boot Time` vs `Making Your Rails App Start Faster`): expected to be reported as NOT similar. This is the accepted limitation and must be pinned by a test so nobody "fixes" it by loosening the threshold.
- **Adjacent-but-distinct topics** (`Rails Authentication with Devise` vs `Rails Authorization with Pundit`, `Rails Caching Strategies` vs `Rails Job Queues with Sidekiq`): must stay NOT similar. Over-tightening here silently starves the blog of topics.
- **Short titles** (`Rails 8 Guide` vs `Guide to Rails`): must stay similar despite little text; the two-token backstop must survive.
- **Empty or symbol-only input** (`""`, `"!!!"`, `"   "`): must return false, never throw.
- **Non-English text** (Indonesian hooks in IG Reel): stemming is English-oriented; must degrade to the unstemmed comparison rather than produce false matches. Pinned by the two Indonesian pairs in the fixture, which Task 1 and Task 2 both assert.

---

### Task 1: Shared case fixture + Node predicate

**Files:**
- Create: `scripts/fixtures/title-similarity-cases.json`
- Modify: `scripts/published.mjs:104-132` (replace `meaningfulTokens` + `isSimilarTitle`)
- Test: `scripts/published-selfcheck.mjs` (section 2)

**Interfaces:**
- Produces: `isSimilarTitle(a: string, b: string): boolean` — same signature as today; `stem(word: string): string` module-private.
- Produces: `scripts/fixtures/title-similarity-cases.json` with shape `{ "similar": [[string, string], ...], "distinct": [[string, string], ...] }`, consumed again by Task 2.

- [ ] **Step 1: Write the failing test**

In `scripts/published-selfcheck.mjs`, right after the existing section-2 assertions, add:

```js
import { readFileSync } from "node:fs";

const cases = JSON.parse(
  readFileSync(new URL("./fixtures/title-similarity-cases.json", import.meta.url), "utf8"),
);
for (const [a, b] of cases.similar) {
  assert.equal(isSimilarTitle(a, b), true, `expected similar: ${a} || ${b}`);
  assert.equal(isSimilarTitle(b, a), true, `expected similar (reversed): ${b} || ${a}`);
}
for (const [a, b] of cases.distinct) {
  assert.equal(isSimilarTitle(a, b), false, `expected distinct: ${a} || ${b}`);
}
assert.equal(isSimilarTitle("", "Anything"), false);
assert.equal(isSimilarTitle("!!!", "   "), false);
```

- [ ] **Step 2: Create the fixture with the measured tables**

`scripts/fixtures/title-similarity-cases.json`:

```json
{
  "similar": [
    ["Rails Migration Testing: A Practical Guide", "Testing Rails Migrations in Production"],
    ["Rails 8 Solid Queue in Production", "Solid Queue in Production with Rails 8"],
    ["Zero-Downtime PostgreSQL Migrations in Rails", "Zero Downtime Database Migrations for PostgreSQL"],
    ["How to Test Rails Migrations", "A Guide to Testing Database Migrations in Rails"],
    ["Rails Caching Strategies", "Caching Strategies for Rails Apps"],
    ["Turbo Streams vs Hotwire Frames", "Hotwire: Turbo Frames and Streams Explained"],
    ["Scaling Sidekiq Workers", "Sidekiq Scaling: Running Many Workers"],
    ["Ruby on Rails Authentication with Devise", "Devise Authentication in Rails"],
    ["Rails 8 Guide", "Guide to Rails"],
    ["Introducing [OI] GPT-5 for Developers", "[OI] introduces GPT-5 for developers!"],
    ["Webb finds glass rain on exoplanet", "NASA Webb Finds Glass Rain on Exoplanet!"],
    ["Migrating from Devise to Rails Authentication", "Rails Authentication Migration Away from Devise"]
  ],
  "distinct": [
    ["Ruby on Rails 8 Release Notes", "PostgreSQL Vacuum Tuning Guide"],
    ["Rails Authentication with Devise", "Rails Authorization with Pundit"],
    ["Deno 3 Native HTTP Server Benchmarks for Backend Teams", "Zero-Downtime PostgreSQL Migrations in Rails"],
    ["Rails Migrations", "Kubernetes Ingress Controllers"],
    ["Turbo Streams vs Hotwire Frames", "Stimulus Controllers in Rails"],
    ["Rails Caching Strategies", "Rails Job Queues with Sidekiq"],
    ["Zero-Downtime PostgreSQL Migrations in Rails", "PostgreSQL Index Tuning"],
    ["How to Test Rails Migrations", "Testing React Components"],
    ["Scaling Sidekiq Workers", "Deploying Rails with Kamal"],
    ["Ruby on Rails Authentication with Devise", "Rails API Pagination Patterns"],
    ["Cutting Rails Boot Time", "Making Your Rails App Start Faster"],
    ["Cara edit foto malam", "Membuat video pendek dari foto"],
    ["Trik bikin poster film", "Cara membuat poster bergaya film"]
  ]
}
```

The two Indonesian pairs must stay `distinct`: stemming is English-oriented and must degrade to
plain comparison for Indonesian text, never invent a match.

- [ ] **Step 3: Run the test to verify it fails**

Run: `node scripts/published-selfcheck.mjs`
Expected: FAIL on the first `expected similar` assertion (the current Jaccard predicate misses it).

- [ ] **Step 4: Implement `stem` and the new `isSimilarTitle`**

In `scripts/published.mjs`, replace `meaningfulTokens` (lines 104-110) and the `isSimilarTitle` body (lines 112-132) with `stem`, a stemming token extractor, and the containment predicate:

```js
function stem(word) {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 6 && w.endsWith("ation")) w = `${w.slice(0, -5)}at`;
  else if (w.length > 5 && w.endsWith("ion")) w = w.slice(0, -3);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

function stemmedTokens(normalized) {
  const tokens = new Set();
  for (const w of normalized.split(" ")) {
    if (w.length >= 3 && !STOPWORDS.has(w)) tokens.add(stem(w));
  }
  return tokens;
}
```

and inside `isSimilarTitle`, after the existing exact-equality check:

```js
  const ta = stemmedTokens(na);
  const tb = stemmedTokens(nb);
  if (ta.size === 0 || tb.size === 0) return false;

  let shared = 0;
  for (const tok of ta) {
    if (tb.has(tok)) shared += 1;
  }
  // shortcut: lexical only, so paraphrase with no shared words slips through.
  // Upgrade to an AI judge over the 5 nearest titles if that still bites.
  return shared >= 2 && shared / Math.min(ta.size, tb.size) >= 0.7;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node scripts/published-selfcheck.mjs`
Expected: `published self-check: ok`

- [ ] **Step 6: Commit**

```bash
git add scripts/published.mjs scripts/published-selfcheck.mjs scripts/fixtures/title-similarity-cases.json
git commit -m "fix(dedupe): stem tokens and use containment for title similarity"
```

---

### Task 2: Python predicate mirrors the same algorithm

**Files:**
- Modify: `scripts/ig_reel/story.py:442-463` (replace `_meaningful_tokens` + `is_similar_title`)
- Test: `scripts/ig_reel/selfcheck.py` (deduplication section)

**Interfaces:**
- Consumes: `scripts/fixtures/title-similarity-cases.json` from Task 1.
- Produces: `is_similar_title(a: str, b: str) -> bool` — unchanged signature.

- [ ] **Step 1: Write the failing test**

In `scripts/ig_reel/selfcheck.py`, after the existing `is_similar_title` assertions (line 258), add:

```python
_CASES = json.loads(
    (pathlib.Path(__file__).resolve().parent / "fixtures" / "title-similarity-cases.json").read_text()
)
for _a, _b in _CASES["similar"]:
    assert is_similar_title(_a, _b) is True, f"expected similar: {_a} || {_b}"
    assert is_similar_title(_b, _a) is True, f"expected similar (reversed): {_b} || {_a}"
for _a, _b in _CASES["distinct"]:
    assert is_similar_title(_a, _b) is False, f"expected distinct: {_a} || {_b}"
assert is_similar_title("", "Webb finds glass rain") is False
assert is_similar_title("!!!", "   ") is False
```

Add `import json` to the imports at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 scripts/ig_reel/selfcheck.py`
Expected: FAIL on the first `expected similar` assertion (or `FileNotFoundError` if the fixture path differs — fix the path, not the algorithm).

- [ ] **Step 3: Implement `_stem` and the containment predicate**

In `scripts/ig_reel/story.py`, replace `_meaningful_tokens` (lines 442-443) and the body of `is_similar_title` (lines 446-463) with:

```python
def _stem(word: str) -> str:
    w = word
    if len(w) > 4 and w.endswith("ies"):
        w = w[:-3] + "y"
    elif len(w) > 3 and w.endswith("s") and not re.search(r"(ss|us|is)$", w):
        w = w[:-1]
    if len(w) > 5 and w.endswith("ing"):
        w = w[:-3]
    elif len(w) > 4 and w.endswith("ed"):
        w = w[:-2]
    if len(w) > 6 and w.endswith("ation"):
        w = w[:-5] + "at"
    elif len(w) > 5 and w.endswith("ion"):
        w = w[:-3]
    if len(w) > 3 and w.endswith("e"):
        w = w[:-1]
    return w


def _stemmed_tokens(normalized: str) -> set[str]:
    return {_stem(w) for w in normalized.split() if len(w) >= 3 and w not in _DEDUPE_STOPWORDS}
```

and inside `is_similar_title`, after the exact-equality check:

```python
    ta = _stemmed_tokens(na)
    tb = _stemmed_tokens(nb)
    if not ta or not tb:
        return False
    shared = len(ta & tb)
    # shortcut: lexical only, so paraphrase with no shared words slips through.
    # Upgrade to an AI judge over the 5 nearest titles if that still bites.
    return shared >= 2 and shared / min(len(ta), len(tb)) >= 0.7
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 scripts/ig_reel/selfcheck.py`
Expected: `ig_reel selfcheck: all assertions passed`

- [ ] **Step 5: Confirm both languages agree**

Run: `node scripts/published-selfcheck.mjs && python3 scripts/ig_reel/selfcheck.py`
Expected: both print their ok line. Since both read the same fixture, agreement is proven by construction.

- [ ] **Step 6: Verify a blog writer still runs end to end**

Run: `DRY_RUN=true AI_STUB=true node scripts/railsdev-blog-writer.mjs`
Expected: reaches the skip or stub path without throwing; the log line `unseen signals:` still appears.

- [ ] **Step 7: Commit**

```bash
git add scripts/ig_reel/story.py scripts/ig_reel/selfcheck.py
git commit -m "fix(ig-reel): mirror the stemmed containment title match"
```
