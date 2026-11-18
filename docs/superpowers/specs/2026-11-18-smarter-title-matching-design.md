# Smarter Title Matching for Deduplication — Design

**Date:** 2026-11-18
**Status:** Pending owner approval
**Related:** `docs/superpowers/specs/2026-11-18-deduplication-and-trending-top5-design.md` (the ledger + gate this improves)

## Intent

The existing deduplication gate lets near-duplicate topics through. Measured against the
current `isSimilarTitle` (Jaccard over tokens ≥3 chars, thresholds 0.65 / 0.75):

```
miss | Rails Migration Testing: A Practical Guide || Testing Rails Migrations in Production
miss | Zero-Downtime PostgreSQL Migrations in Rails || Zero Downtime Database Migrations for PostgreSQL
miss | How to Test Rails Migrations || A Guide to Testing Database Migrations in Rails
miss | Rails Caching Strategies || Caching Strategies for Rails Apps
miss | Ruby on Rails Authentication with Devise || Devise Authentication in Rails
```

Two root causes:

1. **No stemming** — `migration` ≠ `migrations`, `test` ≠ `testing`.
2. **Jaccard punishes long titles** — one differing tail ("A Practical Guide") drags the
   score to ~0.3 even when the subject is identical.

So "similar topic" is currently enforced only by a soft prompt hint
(`Avoid all of these existing posts`), not by code.

## Goals / Non-Goals

**Goals**
- Catch the five misses above in code, before AI tokens are spent.
- Keep both copies of the algorithm (Node and Python) provably in sync.
- Zero new dependencies, zero new AI calls, zero schema changes.

**Non-Goals**
- Catching true paraphrase (`Cutting Rails Boot Time` vs `Making Your Rails App Start
  Faster`). Deterministic lexical matching cannot; that needs an AI judge, deferred.
- Cross-site deduplication. Scope stays **per-site**: `blog:railsdev`, `blog:fullstackweb`
  and `blog:inasoft` may each cover the same topic independently.
- Changing `normalizeTitle` / `normalize_title` semantics. They are also used as exact
  keys (`buildBlogHistory` keywords, `buildBlogAvoidList`); stemming lives only inside
  token extraction, so exact-key behaviour is untouched.
- Reaching into the IG Reel hook/beat generation rules. Only the shared similarity
  predicate changes.

## Approaches Considered

1. **Stronger lexical score (chosen)** — stemming + containment coefficient, mirrored in
   Node and Python. Catches every measured miss, costs nothing, deterministic, testable.
2. **Lexical + AI judge in the ambiguous band** — would catch paraphrase, but adds one AI
   call per article on a free provider chain that frequently returns 429.
3. **Canonical topic keys in the ledger** — most accurate, but needs backfill of 500+
   existing articles and consistent key generation by the model. Disproportionate.

## The Algorithm

Shared by `isSimilarTitle` (`scripts/published.mjs`) and `is_similar_title`
(`scripts/ig_reel/story.py`), and locked by one identical case table in both self-checks.

```
normalize(text)        NFKD, strip diacritics, lowercase, non-alphanumeric → space, collapse
stem(word)             ies→y | trailing s (not ss/us/is) | ing | ed | ation→at | ion | trailing e
tokens(text)           normalize → split → drop len<3 → drop stopwords → stem
similar(a, b)          a == b (normalized)
                       OR shared >= 2 AND shared / min(|A|, |B|) >= 0.7
```

Stopwords stay `{the, and, dan, yang}`. Ordering of the stem rules matters and is fixed:
plural → `ing`/`ed` → `ation`/`ion` → trailing `e`.

Verified stem collapses: `migration/migrations/migrate → migrat`,
`test/testing/tested → test`, `caching/cached/cache → cach`,
`queries/query → query`, `authentication/authenticate → authenticat`.

Containment rather than Jaccard is what fixes the long-title penalty: a short title fully
covered by a longer one scores 1.0.

### Measured behaviour

| Set | Cases | Result |
|---|---|---|
| Duplicates (incl. the five misses) | 12 | 12 caught |
| Non-duplicates (incl. `Devise` auth vs `Pundit` auth, `Rails Migrations` vs `Kubernetes Ingress`, and the paraphrase pair) | 11 | 0 false positives |

Both implementations return byte-identical verdicts on the table.

### Known limitation (accepted)

Paraphrase with no shared vocabulary is not caught. Recorded as a `shortcut:` comment at
the predicate: upgrade to an AI judge over the top-5 lexically nearest titles if
duplicate topics still surface.

## Changes

| File | Change |
|---|---|
| `scripts/published.mjs` | Add `stem` + token extraction; rewrite `isSimilarTitle` body. `normalizeTitle` unchanged. |
| `scripts/ig_reel/story.py` | Add `_stem` + `_meaningful_tokens` stemming; rewrite `is_similar_title` body. `normalize_title` unchanged. |
| `scripts/published-selfcheck.mjs` | Add the 12 positive + 11 negative case table; keep existing assertions. |
| `scripts/ig_reel/selfcheck.py` | Same case table, so a divergence in either language fails its own check. |

No caller changes: `checkTopicCollision`, `filterUnseenCandidates`, `buildBlogHistory`,
`filter_unseen_news`, `tip_duplicate_error` and `find_news_story` all keep their
signatures and simply get a stricter predicate.

## Consequence to Accept

A stricter gate means more clean skips (`exit 0`, nothing published) when the day's
signals all resemble existing posts. That is the intended trade: no duplicate beats an
extra article.

## Verification

- `node scripts/published-selfcheck.mjs`
- `python3 scripts/ig_reel/selfcheck.py`
- `npm run published:selfcheck`
- `DRY_RUN=true AI_STUB=true node scripts/railsdev-blog-writer.mjs` (and the other two
  blog writers) — confirms the gate still runs end to end.
- Re-run the five original misses as explicit assertions.

## Left to the Builder

- Exact placement of the `shortcut:` comment and whether the shared case table lives in
  a small JSON fixture or inline in each self-check.
