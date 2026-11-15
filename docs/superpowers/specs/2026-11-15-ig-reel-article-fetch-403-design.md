# IG Reel: survive blocked article pages (short design)

Date: 2026-11-15. Size: small change, one file plus its selfcheck and docs.

## Intent and why

The first live run of the cinematic Reel (run 43662211149, 08:15 WIB slot) posted nothing:
all three shortlisted stories were Phys.org items, and Phys.org answers every article-page
request with HTTP 403. The cinematic format needs the article text to ground the story, so a
source whose pages cannot be read can never produce a Reel, and a shortlist made only of that
source kills the run. The Reel must post at every slot.

Measured 2026-11-15 from a local machine with the pipeline's user agent:

| Source | Feed | Article page | Full text in feed (`content:encoded`) |
|---|---|---|---|
| ScienceDaily | 60 items | 200, 6,000 chars extracted | no |
| Phys.org | 30 items | 403 (also with Chrome UA + browser headers) | no |
| NASA | 10 items | 200, but 587 chars on an image article (< 800 minimum) | yes, ~4,300 chars |
| MIT News research | 50 items | 200, 6,000 chars extracted (4 of 4 tried) | yes, 6,000 to 8,600 chars |

## Goals

- A run fails only when no candidate story can be grounded, not when one source blocks us.
- Every source in the feed list can actually yield a story.

## Non-goals

- Getting past Phys.org's bot protection (headless browser, proxy, header spoofing).
- Changing story writing, validation, rendering, schedule, or the AI chain.

## Anti-goals

- Posting a story that is not grounded in real article text. The 800-char minimum and the
  number-grounding check stay as they are.
- Many extra AI calls per run. Story writing still happens only after a text is in hand.

## Approaches

1. **Swap the source, widen the shortlist, use feed full text (picked).** Fixes the cause
   (a dead source) and the fragility (three picks, one site). Small, no new dependency.
2. **Swap the source only.** Smallest change, but the next site that starts blocking fails
   runs the same way.
3. **Fetch Phys.org with headless Chrome** (Playwright is already installed for rendering).
   Keeps the source, but works against their bot protection, was not testable, and may break
   again without notice.

Owner picked approach 1 with **MIT News** as the replacement source.

## Design (`scripts/ig_reel_daily.py`)

1. **Feeds.** Replace `("Phys.org", "https://phys.org/rss-feed/")` with
   `("MIT News", "https://news.mit.edu/rss/research")`.
2. **Feed full text.** `fetch_candidates` also reads `content:encoded` (tag `encoded` after
   namespace stripping) into a new candidate field `body`: tags stripped, whitespace collapsed,
   capped at `ARTICLE_PROMPT_MAX`. `desc` stays the 220-char teaser used for the shortlist prompt.
3. **Article text.** `fetch_article` returns `body` without a network request when it has at
   least `ARTICLE_MIN` chars; otherwise it fetches the page as today. If the page fetch fails or
   comes back short and a shorter `body` exists, the existing "too short" path handles it.
4. **Shortlist.** `pick_shortlist` asks the AI for 6 ranked refs (was 3) and returns up to 6.
   Before returning, refs are reordered so sources alternate: keep the AI's rank order, but
   take the best not-yet-used source first on each pass (round-robin by source, stable within
   a source). The main loop is unchanged and tries each ref until one yields a story.
5. **Failure message.** Unchanged shape; it now lists up to 6 reasons.

## Verification

- `python3 scripts/ig_reel/selfcheck.py` gains cases for: source-alternating order, feed
  `body` used without a page fetch, and fallback to the page when `body` is short.
- One `dry_run=true` dispatch of `ig-reel.yml` on the PR branch; the log must show a story
  and the artifact must contain the mp4. This is also the first check of MIT News from a
  GitHub runner.

## Docs

`docs/status.md` gotcha 28 and `AGENTS.md` get one line each: sources are ScienceDaily,
MIT News, NASA; Phys.org article pages are 403 to non-browser clients.

## Left to the builder

Helper names, where the reorder helper lives (`ig_reel/story.py` next to `interleave` is the
natural place), and exact selfcheck wording.
