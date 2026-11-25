# Citation, port, and voice exemptions in the blog gates — design

**Date:** 2026-11-25
**Status:** approach approved, doc awaiting sign-off
**Touches:** `scripts/grounding.mjs`, `scripts/blog-grounding.mjs`, `scripts/blog-aeo.mjs`,
`scripts/hendranicholas-blog-writer.mjs`, self-checks

## Why

Two independent things make a blog run fail on something that is not a content problem.

### 1. The grounding gate fetches URLs that were never citations

The 2026-11-18 gate made every unreadable citation a hard skip. Real CI runs show the
biggest false-positive class is not a dead source: the model writes a documentation
example as a markdown link, and the gate tries to resolve it.

From the last ~15 blog-writer runs:

| Reported | What it actually is | Numbers |
|---|---|---|
| `http://rails_app`, `http://127.0.0.1`, `http://fastapi_backend` | docker-compose service names | (none) |
| `http://$upstream/health`, `https://$host$request_uri` | nginx variable syntax | (none) |
| `http://localhost/health`, `http://localhost:3000/profile` | local dev URL | (none) |
| `http://unix:/var/www/myapp/shared/tmp/sockets/puma.sock` | nginx unix socket | (none) |
| `https://kubernetes.default.svc` | in-cluster DNS | (none) |

10 of the 13 observed skips were this. In every one the body was fully grounded
(`Numbers not found: (none)`) and the article was discarded over a hostname that was never
meant to resolve. A smaller class is a port quoted in prose (`3000`, `80`) counted as an
unsourced fact.

Genuinely unreadable *public* sources must keep blocking: `https://install.opensre.com`
answers 200 with no body text, `https://download.pytorch.org/whl/cu122` answers 403. Those
are real citations the gate cannot verify, and they still skip.

### 2. "our team" is a red run instead of a rewrite

`railsdev` and `fullstackweb` are one-developer sites and already ban
`our team|our developers|our engineers` with the message *"is one developer: write
'I'"*. `inasoft` has no such ban, correctly — it is an agency and "tim kami" is right.
That scope is already what the owner asked for. Two gaps remain:

- `hendranicholas` is a solo personal blog with no such ban, so "our team" passes there.
- The ban fires as a *validation error*. The 2026-11-25 00:30 fullstackweb run wrote
  "our team" twice in a row and exited 1, even though the prompt already says to write
  "I". Nothing was published, and the red run needed a human to read it.

## Approaches considered

For the citation half:

1. **Classify citations, exempt ports (chosen).** One predicate decides whether a URL is a
   citation at all; non-citations are dropped before fetching and cannot satisfy the
   "needs an external citation" rule either. Ports stop counting as risky numbers.
2. **Downgrade unreadable citations to a warning.** One line, but ships articles whose
   cited source nobody could read — the `install.opensre.com` cases would publish
   unchecked. Rejected: it trades away the gate's actual job.
3. **Both, with unreadable non-blocking when every number is grounded elsewhere.** Same
   trust posture as 1, more code, needs a second grounding pass. Rejected as needless.

For the voice half, owner chose **auto-rewrite in code, then validate**: the model never
gets a second chance to fail, and the ban stays as a safety net. The alternatives were
letting the model rewrite (loses the slot when it ignores the instruction twice) and
skip-if-still-failing (also loses the slot).

## Design

### `isCitationUrl(url)` in `scripts/grounding.mjs`

Exported. True only for an `http:`/`https:` URL whose hostname looks like a public DNS
name:

- has a dot (`rails_app`, `unix`, `$upstream` fail)
- contains no `$` or `_` (`$host$request_uri` fails)
- is not `localhost` / `*.localhost`
- is not an IP literal in loopback, private, or link-local space (`127.0.0.1`, `10.x`,
  `192.168.x`, `172.16-31.x`, `169.254.x`, `::1`)
- does not end in `.svc`, `.local`, `.internal`, or `.cluster.local`

Anything that fails is an *example*, not a citation: never fetched, never reported dead,
never counted as the article's primary source. Deliberately still a citation: `.test` (the
self-checks' fixtures) and every real public host, including unreadable ones.

### Where it is applied

- `blog-grounding.mjs` → `collectSources` skips non-citations before `fetchSourceText`, so
  they never reach `deadSources`. The repair round's re-scan of citations in
  `repairedBody` filters the same way.
- `blog-aeo.mjs` → `externalLinks` (which feeds both the "need >= 1 external primary-source
  citation" check and the `groundArticle` call) is filtered. A body citing only
  `http://rails_app` then fails validation with *"missing external primary-source
  citation"*, which triggers the existing feedback retry and asks for a real source —
  instead of passing validation and dying at the gate.

### Ports in `riskyNumbers`

A number is exempt when **every** occurrence is a port: preceded by `:` or by the word
`port`. Same "every occurrence" shape as the existing version rule, so `:3000` and
`port 80` stop counting while `3000 requests` and `80% faster` still do.

### `fixVoice(body)` in `scripts/blog-aeo.mjs`

Exported, English sites only (`cfg.lang !== "id"`). Called as the first statement of
`ensureRequiredLinks`, which every body already passes through — draft, validation retry,
and grounding repair — so no writer can skip it.

Rewrites `our team` / `our developers` / `our engineers` to first person and repairs the
agreement of the word that follows:

- possessive (`our team's`) → `my`
- `is|are` → `am`; `has` → `have`; `does` → `do`; `isn't` → `am not`
- other verbs: `-ies` → `-y`; `-es` when the stem ends in `s|x|z|ch|sh`; otherwise drop a
  trailing `s` (leaving `-ss` words alone)

`inasoft` is untouched (`lang: "id"`, no ban). The existing `bannedPatterns` entries stay
as a net: if `fixVoice` ever misses a form, validation still catches it.

### `hendranicholas` gets the ban

Add the same `bannedPatterns` entry used by `railsdev`/`fullstackweb`, so a surviving form
is still caught there.

## Verification

- `node scripts/grounding-selfcheck.mjs` — every hostname class above is not a citation;
  `install.opensre.com` and `download.pytorch.org` still are; `:3000` and `port 80` exempt,
  `3000 requests` and `80%` still risky.
- `node scripts/blog-grounding-selfcheck.mjs` — a non-citation link is never fetched and
  never reported dead.
- `node scripts/blog-aeo-selfcheck.mjs` — a body citing only `http://rails_app` fails with
  the missing-citation error; a table of real sentences through `fixVoice` (one per verb
  case above) produces grammatical output and no `our team`; an `id` site is untouched.
- `node scripts/hendranicholas-blog-selfcheck.mjs` — the new ban is present.
- `npm run typecheck` + a `dry_run=true` dispatch per blog workflow.

## Out of scope

- **Sample config decimals in prose** (`limit_req` rates `0.12`, `0.20`, `0.30`). Not a
  port, and not safely distinguishable from an invented number. Still blocks. If it keeps
  firing, the honest fix is the writer prompt, not a wider exemption.
- IG Reel grounding (shares `grounding.mjs`, no citation fetching).
