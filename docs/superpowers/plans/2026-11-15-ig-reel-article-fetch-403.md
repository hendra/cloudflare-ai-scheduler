# IG Reel: Survive Blocked Article Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The IG Reel run posts at every slot even when one news source refuses article-page requests.

**Architecture:** Three pure helpers go into `scripts/ig_reel/story.py` (feed-body cleaning, source-alternating ref order, body-or-page text choice) and are asserted in `scripts/ig_reel/selfcheck.py`. `scripts/ig_reel_daily.py` swaps Phys.org for MIT News, stores each feed item's full text, uses it instead of a page fetch when long enough, and tries 6 ranked stories instead of 3.

**Tech Stack:** Python 3 standard library only (`urllib`, `xml.etree`, `html`, `re`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-ig-reel-article-fetch-403-design.md`

## Global Constraints

- Feed list is exactly: ScienceDaily, MIT News (`https://news.mit.edu/rss/research`), NASA, in that order.
- `ARTICLE_MIN = 800` and `ARTICLE_PROMPT_MAX = 4000` keep their values; the number-grounding and Indonesian checks are untouched.
- No attempt to get past Phys.org's block (no headless-browser fetch, proxy, or header spoofing).
- Story-writing AI calls happen only after an article text of at least `ARTICLE_MIN` chars is in hand.
- `scripts/ig-kit/` stays byte-identical. No change to rendering, schedule, or the AI chain.
- All work lands via a PR from `claude/ig-reel-403-fetch-errors-fc285b`; never commit to `main`.
- `scripts/ig_reel/selfcheck.py` is a flat script of top-level `assert`s; it imports only from `ig_reel.*`, never from `ig_reel_daily` (that module reads env and has side effects at import).

## Review Focus

- Feed body carries HTML tags and entities (`<p>`, `&amp;`, `&nbsp;`): the stored text has none of them. Pinned in Task 1.
- Feed body is longer than the cap: it is cut to the cap, never passed whole to the AI. Pinned in Task 1.
- All ranked refs come from one source: order stays the AI's rank order, nothing is dropped. Pinned in Task 1.
- AI returns fewer than 6 refs (1 or 2): the run still tries what it got. Pinned in Task 1 (single-ref case) and by the existing filter in `pick_shortlist`.
- Feed body is present but under 800 chars (teaser-only feeds): the page is fetched as before. Pinned in Task 1.

---

### Task 1: Pure helpers in `story.py`

**Files:**
- Modify: `scripts/ig_reel/story.py` (add three functions after `interleave`, line 66)
- Test: `scripts/ig_reel/selfcheck.py` (extend the import on lines 13-15; add asserts directly after line 19)

**Interfaces:**
- Produces:
  - `feed_body(raw: str, cap: int) -> str`: drops `<script>`/`<style>` blocks, strips remaining tags, unescapes HTML entities, collapses all whitespace (including `\xa0`) to single spaces, strips, truncates to `cap` chars.
  - `order_by_source(refs: list[int], sources: list[str]) -> list[int]`: `refs` are 1-based indexes into `sources`, in AI rank order. Returns the same refs reordered round-robin by source: repeatedly sweep the remaining refs in rank order, taking the first ref of each source not yet taken in this sweep.
  - `grounding_text(body: str, fetch_page, min_chars: int) -> str`: returns `body` when `len(body) >= min_chars`, else returns `fetch_page()` (a zero-argument callable). Exceptions from `fetch_page` propagate.

- [ ] **Step 1: Write the failing asserts**

Add `feed_body, grounding_text, order_by_source` to the `ig_reel.story` import, then after line 19:

```python
# --- feed full text / source-alternating shortlist (spec 2026-11-15-ig-reel-article-fetch-403) ---
assert feed_body("<p>Tom &amp; Jerry&nbsp;ran</p>\n\n<script>x()</script><b>fast</b>", 100) == "Tom & Jerry ran fast"
assert feed_body("<p>" + "a" * 50 + "</p>", 10) == "a" * 10
assert feed_body("", 10) == ""

_src = ["SD", "MIT", "NASA", "SD", "MIT", "NASA", "MIT"]          # sources of candidates 1..7
assert order_by_source([2, 5, 7, 1, 3, 4], _src) == [2, 1, 3, 5, 4, 7]   # MIT,SD,NASA | MIT,SD | MIT
assert order_by_source([2, 5, 7], _src) == [2, 5, 7]              # one source: rank order kept
assert order_by_source([4], _src) == [4]
assert order_by_source([], _src) == []

def _no_page():
    raise AssertionError("page must not be fetched when the feed body is long enough")
assert grounding_text("x" * 800, _no_page, 800) == "x" * 800
assert grounding_text("x" * 799, lambda: "PAGE", 800) == "PAGE"
assert grounding_text("", lambda: "PAGE", 800) == "PAGE"
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 scripts/ig_reel/selfcheck.py`
Expected: `ImportError: cannot import name 'feed_body'`

- [ ] **Step 3: Implement the three functions in `scripts/ig_reel/story.py`**

Signatures as in Interfaces. `story.py` already imports `html as _html` and `re`.

- [ ] **Step 4: Run to verify it passes**

Run: `python3 scripts/ig_reel/selfcheck.py`
Expected: ends with `ig_reel selfcheck: all assertions passed` (music/render sections may print a "skipped" notice when numpy/playwright are missing; that is fine).

- [ ] **Step 5: Commit**

```bash
git add scripts/ig_reel/story.py scripts/ig_reel/selfcheck.py
git commit -m "feat(ig-reel): helpers for feed full text and source-alternating shortlist"
```

---

### Task 2: Wire into the orchestrator and docs

**Files:**
- Modify: `scripts/ig_reel_daily.py` (`RSS_FEEDS` line 97, import block line 89, `fetch_candidates` line 203, `pick_shortlist` line 298, `fetch_article` line 331, module docstring line 5)
- Modify: `docs/status.md` (gotcha 28), `AGENTS.md` (IG Reel bullet under Architecture)

**Interfaces:**
- Consumes: `feed_body`, `order_by_source`, `grounding_text` from Task 1.
- Produces: candidate dicts gain `"body": str` (may be `""`). `pick_shortlist` returns up to 6 refs.

- [ ] **Step 1: Feeds.** Replace the Phys.org entry with `("MIT News", "https://news.mit.edu/rss/research")`, keeping the order ScienceDaily, MIT News, NASA.

- [ ] **Step 2: Feed body in `fetch_candidates`.** In the per-child loop add a branch for tag `encoded` (that is `content:encoded` after the namespace split): `body = feed_body(txt, ARTICLE_PROMPT_MAX)` when `body` is still empty. Initialise `body = ""` with the other per-item fields and add `"body": body` to the appended dict. `desc` handling is unchanged.

- [ ] **Step 3: `fetch_article`.** Move the current network code (scheme check through `extract_article_text(page)[:ARTICLE_PROMPT_MAX]`) into `_fetch_article_page(cand) -> str`. `fetch_article` becomes: `text = grounding_text(cand.get("body") or "", lambda: _fetch_article_page(cand), ARTICLE_MIN)`, then the existing `desc` prefix and return. The log line says where the text came from: `article: {n} chars from feed body ({link})` or `article: {n} chars from {link}`.

- [ ] **Step 4: `pick_shortlist`.** Change the prompt to ask for 6 (`Pilih 6 temuan …`, and the JSON hint `{"refs": [nomor terbaik, kedua, …, keenam]}`), update the docstring to "up to 6", and replace `return refs[:3]` with:

```python
    refs = order_by_source(refs[:6], [c["source"] for c in candidates])
    log(f"shortlist: {refs}")
    return refs
```

(remove the earlier `log(f"shortlist: {refs}")` so the logged order is the tried order). Update the module docstring line 5 from "shortlists 3 findings" to "shortlists 6 findings".

- [ ] **Step 5: Verify locally**

Run: `python3 -m py_compile scripts/ig_reel_daily.py && python3 scripts/ig_reel/selfcheck.py && git grep -n "Phys" -- scripts`
Expected: selfcheck ends with `all assertions passed`; the `git grep` prints nothing.

Then check the live feeds parse (no secrets needed; run from the repo root):

```bash
python3 - <<'EOF'
import re, sys, urllib.request, xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
from ig_reel.story import feed_body
src = open("scripts/ig_reel_daily.py").read()
ua = re.search(r'^UA = "(.+)"$', src, re.M).group(1)
for name, url in re.findall(r'\("([^"]+)", "(https://[^"]+)"\),', src):
    xml = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": ua}), timeout=25).read()
    items = [n for n in ET.fromstring(xml).iter() if n.tag.split("}")[-1] == "item"]
    bodies = [feed_body(c.text or "", 4000) for n in items for c in n if c.tag.split("}")[-1] == "encoded"]
    print(name, "items", len(items), "bodies>=800:", sum(len(b) >= 800 for b in bodies))
EOF
```

Expected: three lines; `MIT News` shows about 50 items with `bodies>=800` close to the item count; `ScienceDaily` shows `bodies>=800: 0`.

- [ ] **Step 6: Docs.** In `docs/status.md` gotcha 28 add: "Sources (2026-11-15): ScienceDaily, MIT News research, NASA. Phys.org was dropped: its article pages answer HTTP 403 to non-browser clients, which failed run 43662211149 when all three shortlisted stories were Phys.org. The shortlist is now 6 refs tried in source-alternating order, and a feed item's own full text (`content:encoded`, ≥ 800 chars) is used instead of fetching the page." In `AGENTS.md`, extend the IG Reel bullet with: "Sources: ScienceDaily, MIT News, NASA (Phys.org article pages are 403 to non-browser clients)."

- [ ] **Step 7: Commit**

```bash
git add scripts/ig_reel_daily.py docs/status.md AGENTS.md
git commit -m "fix(ig-reel): replace Phys.org, use feed full text, try 6 source-alternating stories"
```

---

### Task 3: PR and CI dry run

**Files:** none.

- [ ] **Step 1: Conflict-marker check and push**

Run: `git grep -n -E '^(<<<<<<< |>>>>>>> )' -- . ; git push -u origin claude/ig-reel-403-fetch-errors-fc285b`
Expected: the grep prints nothing; push succeeds.

- [ ] **Step 2: Dry run on the branch**

Run: `gh workflow run ig-reel.yml --ref claude/ig-reel-403-fetch-errors-fc285b -f dry_run=true`, then `gh run watch` on the new run.
Expected: run succeeds; the log shows `shortlist:` with up to 6 refs, an `article:` line, a `story:` line, and the `ig-reel-dry-run` artifact contains the mp4. This is the first check of MIT News from a GitHub runner; if its feed or pages fail there, stop and report rather than patching around it.

- [ ] **Step 3: Open the PR** against `main` with `## Summary`, `## What changed`, `## Verification` (the real commands and the dry-run URL), `## Out of scope` (getting past Phys.org's block), linking the spec and failed run 43662211149.
