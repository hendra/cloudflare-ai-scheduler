# Unreadable citations stop discarding grounded articles — design

**Date:** 2026-11-26
**Status:** approved 2026-11-26; plan in `docs/superpowers/plans/2026-11-26-unreadable-citations.md`
**Touches:** `scripts/grounding.mjs`, `scripts/blog-grounding.mjs`, the four blog writers,
`scripts/grounding-selfcheck.mjs`, `scripts/blog-grounding-selfcheck.mjs`

## Why

A run skips an article and posts the INASOFT skip note when the gate cannot read one of its
citations, even when every number in the body is grounded (`Angka yang tidak ada di sumber
mana pun: (tidak ada)`). The gate's job is "no unverifiable number reaches a published
article". Discarding a fully grounded article over one link the *fetcher* cannot read is a
different thing, and it costs a publishing slot.

The 2026-11-25 spec (`2026-11-25-citation-and-port-exemptions-design.md`) already removed
the largest class of this (docker-compose names, `localhost`, IP literals, `$host`
variables) by classifying what counts as a citation. Two classes survived, and both were
measured against the live URLs:

| Reported | Measured now | Verdict |
|---|---|---|
| `https://install.opensre.com` | 200, `application/x-sh`, 50 KB of real text | **readable** — rejected only by the `content-type: html` check |
| `https://install.opensre.com/install.ps1` | 200, `text/plain`, 42 KB | **readable** — same cause |
| `https://download.pytorch.org/whl/cu122` | 403 S3 `AccessDenied` | bot/private-blocked, not a dead page |
| `https://stitch.withgoogle.com/docs/learn/device-types/` | 200, HTML, 33 KB, but 23 chars of extracted text (JS-rendered SPA) | real page, nothing to read |

So: two of the four are a plain fetcher bug (it only ever accepted `text/html`), and two are
pages that exist but cannot be read by a plain HTTP client.

A separate false positive: port numbers. `port 80` and `:3000` are exempt, but only in the
singular form. `ports 80 dan 443`, `EXPOSE 80`, `port: 80`, and the tail of
`port 8080 dan 80` still count as unverified facts.

## Approaches considered

1. **Downgrade every unreadable citation to a warning.** Smallest, but ships an article
   whose primary source nobody could read, including 404s the model invented. Rejected on
   its own: it trades away the check instead of fixing it.
2. **Widen what counts as readable.** Accept text-bearing content types and treat
   bot-blocked/empty responses as "unreadable, not dead". Fixes the fetcher bug, but a
   404 — a citation that is simply wrong — still discards the article.
3. **Both, in that order (owner's pick).** Widen first so real sources are actually read,
   then keep only the hard failures fatal. 404s and network errors still block, so the
   repair call still gets its chance to drop a broken link.

## Design

### 1. `fetchSourceText` reads text, not just HTML (`scripts/grounding.mjs`)

Accept a response when its `content-type` is HTML, `text/*`, or one of
`application/x-sh`, `application/json`, `application/xml`, `application/javascript` — the
types that carry readable text. HTML still goes through `extractPageText`; anything else is
used as the decoded body directly, because tag-stripping a shell script or a JSON document
corrupts it. Both paths are cut at the **same** 200 000-char cap: a 50 KB installer must
not get a 10× larger grounding surface than a 50 KB HTML page. The `MIN_SOURCE_CHARS` floor
and the 2 MB byte cap stay.

Every failure now carries a `reason`, so the caller can tell the classes apart instead of
seeing one anonymous `ok: false`:

| `reason` | When | Fatal? |
|---|---|---|
| `status` | 4xx other than 401/403/429 (404, 410, …) | **yes** |
| `network` | DNS failure, TLS error, timeout, non-http scheme | **yes** |
| `blocked` | 401, 403, 429, and any 5xx — the page may exist but this client cannot read it | no |
| `type` | 2xx with a content type that carries no readable text (PDF, image) | no |
| `empty` | 2xx, readable type, but under `MIN_SOURCE_CHARS` of text | no |

`blocked` is deliberately not applied to 404/410: "the server refused me" and "the page is
not there" are different facts and only the second is a bad citation. 5xx is grouped with
`blocked` because a transient server fault is not the article's fault and there is no retry
inside a run.

### 2. `groundArticle` separates hard failures from unreadable sources (`scripts/blog-grounding.mjs`)

`collectSources` returns `{ sources, deadSources, unreadable }`:
`deadSources` = `status`/`network` only, `unreadable` = `blocked`/`type`/`empty`.

`ok` becomes "**at least one readable source**, no unverified numbers, and no dead source".
`unreadable` never fails the article on its own; it is returned so the writer can log it.
The repair round keeps its current behaviour: a dead citation the repair removed stops
blocking, a new dead citation it introduces starts blocking, and a repair-added unreadable
citation is added to `unreadable` like any other.

**The "at least one readable source" clause is the load-bearing part.** Without it, an
article whose prose holds no risky numbers (only years, ports, small counts) and whose only
citation is a 403 would publish with nothing verified at all. With it, the
`download.pytorch.org/whl/cu122` case pinned as must-block in the 2026-11-25 spec still
blocks: that 403 is the article's only source, so no source was read. A readable signal page
satisfies the clause, because the body was checked against it.

**Why this does not otherwise weaken the gate.** `checkGrounding` is unchanged: a risky
number still has to appear in some readable source. An unreadable citation grounds nothing —
it just stops being fatal on its own. The failure mode this fixes is "everything was
grounded, one link could not be opened". The failure mode it must not create, "the number
came from the unreadable link", still fails.

Accepted consequence, stated plainly: a non-HTML body grounds numbers verbatim, the same
way a `<pre>` block inside an HTML page already does. A cited shell installer is a real
published source whose constants a reader can check, so this is the same trust level, not a
new one. The shared 200 000-char cap keeps the surface equal.

### 3. Writers log unreadable citations

Each of the four blog writers already logs `grounding ok — N source(s) read`. Add one line
next to it:

```js
if (g.unreadable.length) console.log(`::warning title=Unreadable citations::${g.unreadable.join(" | ")}`);
```

The Slack skip note keeps showing `deadSources` only, since that is now the only fatal list,
but its label must stop saying "Unreadable citations" / "Sitasi yang tidak bisa dibaca" and
say what the list now is: "Citations that could not be fetched (404 / network)". Otherwise
the note misreports a 404 as a readability problem.

### 4. Port lists are ports (`riskyNumbers` in `scripts/grounding.mjs`)

The existing rule — a number is exempt when **every** occurrence is a port — stays. What
changes is the port test, which today only fires on a singular lead-in. Two forms:

- **explicit lead-in** (new, no tail check): preceded by `port`, `ports`, `port:`,
  `ports:`, or `EXPOSE`. This is the same trust today's `port 80` already gets — the author
  named it a port.
- **list continuation** (new, tail-checked): preceded by a `,` / `dan` / `and` following a
  number that was itself a port, **and** followed by exactly one of: end of text, `,` `.`
  `;` `:` `)`, `dan`, `and`. A number followed by a word is a claim, which is what keeps
  `port 3000 and 5000 requests` honest.
- **colon form** (unchanged): preceded by `:` with an empty or host-like label.

So `ports 80 dan 443`, `EXPOSE 80`, `port: 80`, `port 8080 dan 80` are ports, while
`port 3000 and 5000 requests` keeps `5000` a claim and `3000 requests` / `80% faster` stay
claims exactly as today. `rails_app:3000/health` stays a port through the unchanged colon
form, so `/health` never reaches the list rule.

Correction to the obvious reading of the code comment: the label check at
`grounding.mjs:105-108` already rejects `Timeout:3000`; the missing piece was never a unit
rule, it was list continuation.

## Verification

- `node scripts/grounding-selfcheck.mjs` — a `text/plain` and an `application/x-sh` body
  ground a number; 403 and 503 → `blocked`, 404 → `status`, a short JSON body → `empty`
  (the existing assertion at `grounding-selfcheck.mjs:53-54` keeps passing but its message
  must be updated from "non-HTML is refused"); `ports 80 dan 443`, `EXPOSE 80`, `port: 80`,
  `port 8080 dan 80`, `80/tcp` are not risky; `port 3000 and 5000 requests`,
  `3000 requests`, `80% faster`, `Timeout:3000 ms` still are; `rails_app:3000/health` stays
  a port.
- `node scripts/blog-grounding-selfcheck.mjs` — a 403 citation no longer blocks a grounded
  article and is reported in `unreadable`; a 404 citation still blocks; an unreadable
  citation still cannot ground the number it is cited for; **an article whose only citation
  is 403 still blocks** (the at-least-one-readable-source rule).
- `npm run typecheck` (unchanged files outside `src/`, run anyway) + `npm run aeo:selfcheck`,
  `npm run published:selfcheck`, `npm run topicmix:selfcheck` for the shared-writer path.
- A `dry_run=true` dispatch of `inasoft-blog-writer.yml`.

## Out of scope

- Rendering JS-only pages (headless Chrome) so `stitch.google.com` becomes readable. The
  pipeline has no browser in the grounding path; a warning is the honest outcome.
- PDF text extraction. A PDF citation is now a warning instead of a skip.
- Re-checking whether the 2026-11-18 "unreadable citation is always fatal" decision should
  be revisited for 404s. Kept fatal here.
