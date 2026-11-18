# Grounded content: no invented facts in blog articles and IG Reels

Date: 2026-11-18
Status: approved design, ready for plan

## Intent and why

Every published artifact (3 blog writers + IG Reel news) must state only what a
real, fetchable source says. Today the pipelines *ask* the model not to invent
numbers/benchmarks/prices, but only IG Reel news actually checks it:

- `scripts/blog-aeo.mjs` requires ≥1 external `https://` link, and the writers
  only HEAD-check those links (up to 2 dead links still ship). The article body
  is written from the model's own knowledge; nothing in it is compared to a
  source.
- `scripts/ig_reel/story.py:check_story` rejects any number absent from the
  fetched article text (hard fail + one repair). Proper nouns, product names and
  non-numeric claims are unverified.
- IG Reel *tips* have no source by design (they are practical opinion) and keep
  their current rules: no prices, no percentages, no model version names, no
  numbers above 10.

Goal: a fabricated number, benchmark or price cannot reach a published article
or Reel. When a piece cannot be grounded, it is **not published**: the run exits
0 and says so in Slack.

## Goals

- Blog: no number in prose that is not present in a cited, fetchable source.
- Blog: every cited external link resolves to a real page (GET 200 + text), not
  merely a live host.
- Blog: the chosen signal's own page text reaches the body prompt as source
  material (cheap upstream improvement).
- IG Reel news: numbers (already enforced) plus proper nouns — a capitalised
  mid-sentence token must appear in the article text.
- One shared, deterministic checker; no second model, no LLM judge.

## Non-goals / anti-goals

- Not a general fact-checker. Claims that carry no number or proper noun are out
  of scope for the blog gate (a model-judge was rejected: non-deterministic,
  costs a call, and its verdict can itself be invented).
- IG Reel tips stay unsourced by design; their existing tip rules are unchanged.
- No new dependency. No new provider, queue, table or config value.
- Does not verify that a source *supports* a claim, only that the numbers and
  proper nouns it uses exist in that source.

## Design

### 1. New shared module `scripts/grounding.mjs`

Pure helpers plus one fetcher, mirroring `story.py`'s existing logic so the two
pipelines agree on what counts as the same number:

- `numbersIn(text, { keepRaw = true })` — normalised number extraction with
  thousands/decimal disambiguation (`8.700` / `8,700` → `8700`) and Indonesian
  and English scale words (`ribu`, `juta`, `miliar`, `thousand`, `million`,
  `billion`, `trillion`). Port of `story.py:numbers_in`.
- `riskyNumbers(text)` — the gate's input set, as normalised numeric strings: numbers
  with ≥2 digits (10+), plus any number that appears as a percentage, a currency
  amount, or a `vX.Y` / model-version token. Small counts ("3 layers", "2 ways")
  are ignored on purpose — they carry no factual risk and appear in ordinary
  prose constantly. Four-digit years 1990–2100 are **not** risky, mirroring IG
  Reel's `extra_allowed=years`: "as of 2026" or "since Node 20" must not fail
  because a cited page omits the year.
- `proseOnly(markdown)` — body with fenced code blocks, inline code, frontmatter,
  link URLs and markdown table pipes' cell padding removed, so code samples and
  URLs never count as claims.
- `fetchSourceText(url)` — GET, `text/html` only, 2 MB cap, returns
  `{ ok, status, text }`; `ok` requires 2xx **and** ≥200 chars of extracted text.
  Extraction takes `p, li, pre, td, dd, blockquote` text with `script/style/nav/
  header/footer/aside/noscript/svg` stripped — deliberately wider than IG Reel's
  `<p>`-only rule, because the blog prompt invites RFC/spec/doc citations whose
  bodies live in `<pre>`/`<li>`/`<td>`. A page with no semantic blocks at all
  (div-only) falls back to its whole stripped text instead of reading as dead. The
  full page text is kept for checking, so a number deep in a long doc is still
  grounded; only the text pasted into a prompt is capped.
- `checkGrounding({ body, sources })` → `{ ok, errs, unverified, deadSources }`.
  `sources` is `[{ url, text }]`. Errors: a cited link that failed to fetch, and
  each risky number in `proseOnly(body)` absent from every source text.

### 2. Blog writers (`railsdev`, `fullstackweb`, `inasoft`)

- Replace the `headOk()` HEAD loop with `fetchSourceText()` on the body's
  external links; keep the existing "links are collected by `validateAeoGeo`"
  flow, but **drop `validateAeoGeo`'s 15-link cap** (`links: externalLinks
  .slice(0, 15)`) so every citation is both fetched and checked — otherwise a
  number correctly quoted from source #17 is reported as invented. A link that
  does not return usable text is a **hard error** (the old "≤2 dead links
  tolerated" rule goes away — a citation that cannot be read cannot ground
  anything).
- Grounding sources = the fetched cited pages **+** the chosen signal's page
  text (`chosenSignal.url`, fetched with the same helper; skipped silently if it
  does not fetch, since signals are HN threads and repo pages).
- On failure: one repair call that lists the offending numbers/links **and
  re-sends the fetched source texts**, so the model can substitute the correct
  figure instead of only deleting the claim. Then re-check. Still failing →
  **skip**: post a Slack note naming the article, the unverified numbers and the
  dead links, then `process.exit(0)`. Nothing is committed, no PR, no ledger row.
- A skipped topic is not recorded anywhere: HN/GitHub signals rotate within days,
  so the same signal is not reselected indefinitely.
  `shortcut: a signal whose article always fails grounding can be retried on a
  later run; add a rejection record to the ledger if that ever burns real quota.`

- The signal page text (capped at 6000 chars, same cap as IG Reel) is appended
  to the body prompt under a `Source material (facts you may state):` heading
  with the instruction that facts outside it must not be stated as fact.

### 3. IG Reel news (`scripts/ig_reel/story.py`)

- Add `proper_noun_errors(data, article_text)`: it scans only the `hook` and each
  beat's `text`/`highlight` (not captions, CTA or hashtags). A name is a
  capitalised token **in the middle of a sentence** that the article never uses.
  Sentence-initial tokens are exempt because Indonesian capitalises every
  sentence while the script is Indonesian and the article English ("Earth"
  legitimately becomes "Bumi"). A small platform-word set (`Reel`, `Instagram`, …)
  is exempt too, since the prompt itself tells the model to write them.
- The finding is **hard**, so it rides `write_story`'s existing one-repair path:
  the model renames the object to the article's own term or rephrases the
  sentence, and only a second failure drops that candidate. Soft was rejected —
  `apply_story_limits` only truncates soft findings, so an invented name would
  ship. An earlier first-token-only exemption was rejected too: it flagged the
  start of every second sentence, so no candidate ever passed and the account
  stopped posting.
- No curated translation exemption list: it would need constant maintenance and
  still leak. `shortcut: translated names mid-sentence cost one repair call;
  upgrade to a name allowlist if skips ever spike.`
- Existing `copied_from_article` / language logic stays.

- No prompt change beyond one added line: names and product names must come from
  the article.

### 4. Proof

- `scripts/grounding-selfcheck.mjs` + `npm run grounding:selfcheck`: number
  normalisation (ID/EN scales, thousands vs decimal), `proseOnly` ignoring code
  fences and inline code, `riskyNumbers` thresholds, and a pass/fail pair of
  `checkGrounding` cases including a dead-source case.
- `scripts/blog-aeo-selfcheck.mjs` stays green: grounding is a separate call,
  not wired into `validateAeoGeo`, so its fixtures (which contain "Node 20" and
  "O(1)") are unaffected.
- `scripts/ig_reel/selfcheck.py`: a fabricated proper noun is reported, a real
  one passes, and a translated name costs exactly one repair, not a hard failure.

Builder decisions left open and settled here: grounding is bypassed under
`AI_STUB` and runs under `DRY_RUN`; the gate runs after `validateAeoGeo` passes
and before cover generation/build (so a skipped article costs no cover render);
source fetches run sequentially with the existing per-request timeout.
- Manual: one `dry_run=true` dispatch per blog workflow (expect either a normal
  dry run or a clean skip) and one IG Reel dry run.

## Known limits (documented as `shortcut:` comments)

- Allowed-number sets come from whole page text, so a number that appears
  anywhere on a cited page is licensed even if it means something else there.
  Upgrade to article-scoped extraction if that proves exploitable.
- Blog claims without numbers or proper nouns are still unverified; the blog gate
  is a floor, not a fact-checker.
- Proper-noun checking is news-only; a blog post legitimately names many products
  its sources do not mention.

## Out of scope

- IG Reel tips grounding (kept as-is per owner decision).
- The trending/jobs digests, which already render only fetched data.
- Any change to publishing cadence, queue, D1 schema or secrets.
