# Citation, Port, and Voice Exemptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the blog pipeline discarding fully-grounded articles over example hostnames, port numbers, and the phrase "our team".

**Architecture:** Three small additions to existing shared modules. `scripts/grounding.mjs` gains an `isCitationUrl` predicate and a port exemption inside `riskyNumbers`. `scripts/blog-grounding.mjs` and `scripts/blog-aeo.mjs` use the predicate so non-citations are never fetched, never reported dead, and never satisfy the "needs a citation" rule. `scripts/blog-aeo.mjs` gains `fixVoice`, called from `ensureRequiredLinks` so every body passes through it. `hendranicholas` gets the same banned-phrase entry the two other solo sites already have.

**Tech Stack:** Node 20 ESM, zero dependencies, assert-based self-checks (`node scripts/*-selfcheck.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-25-citation-and-port-exemptions-design.md`

## Global Constraints

- Zero new dependencies. Node 20 ESM only.
- Verification is `node scripts/<name>-selfcheck.mjs` + `npm run typecheck` (typecheck covers `src/**/*.ts` only, so it will not see these scripts — run it anyway, it must stay green).
- No behaviour change for `inasoft.id` (Indonesian site): `fixVoice` and the "our team" ban are English-site only.
- Never commit to `main`. Branch `fix/blog-citation-voice-exemptions`, one PR.
- Every new exported helper gets self-check assertions in the existing self-check file for its module.

## Review Focus

- **A citation-shaped URL that is unreadable must still block.** `https://install.opensre.com` (200, no body text) and `https://download.pytorch.org/whl/cu122` (403) are real citations. If `isCitationUrl` is too loose they stop blocking and unverified facts ship. Pinned by Task 1's assertions.
- **A port number in another context must stay risky.** `:3000` and `port 80` are exempt; `3000 requests` and `80% faster` are not. Pinned by Task 2.
- **A non-citation must not satisfy the "needs an external citation" rule.** Otherwise a body citing only `http://rails_app` passes validation and dies at the gate — the exact bug. Pinned by Task 4.
- **`fixVoice` must not corrupt fenced code.** A shell sample containing `our team` in a comment is code, not prose. Pinned by Task 5.
- **`fixVoice` must not run on the Indonesian site.** "tim kami" is correct there. Pinned by Task 5.

---

### Task 1: `isCitationUrl` in the grounding module

**Files:**
- Modify: `scripts/grounding.mjs` (new export near the source-fetching section)
- Test: `scripts/grounding-selfcheck.mjs`

**Interfaces:**
- Produces: `isCitationUrl(url: unknown): boolean` — exported from `scripts/grounding.mjs`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/grounding-selfcheck.mjs`, and add `isCitationUrl` to the existing destructured import at the top of the file:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/grounding-selfcheck.mjs`
Expected: FAIL — `isCitationUrl is not a function` (or `undefined`).

- [ ] **Step 3: Implement `isCitationUrl` in `scripts/grounding.mjs`**

Place it directly above `fetchSourceText`. Parse with `new URL`, reject non-http(s), then reject hostnames that are not public DNS names: no dot; contains `$` or `_`; is `localhost` or ends `.localhost`; is an IPv4 literal in loopback/private/link-local range or the literal `::1`/`[::1]`; ends in `.svc`, `.local`, `.internal`, or `.cluster.local`. Anything that survives is a citation. Non-string and unparseable input returns `false`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/grounding-selfcheck.mjs`
Expected: `grounding-selfcheck: ok`

- [ ] **Step 5: Commit**

```bash
git add scripts/grounding.mjs scripts/grounding-selfcheck.mjs
git commit -m "feat(grounding): distinguish citations from example hostnames"
```

---

### Task 2: Port exemption in `riskyNumbers`

**Files:**
- Modify: `scripts/grounding.mjs` (`riskyNumbers`)
- Test: `scripts/grounding-selfcheck.mjs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: no signature change. `riskyNumbers(text: string): string[]` simply omits port-only figures.

- [ ] **Step 1: Write the failing test**

Append to `scripts/grounding-selfcheck.mjs`:

```js
// --- a number that is only ever a port is not a factual claim ---
assert.deepEqual(riskyNumbers("It listens on :3000 in development."), []);
assert.deepEqual(riskyNumbers("Expose port 80 and port 443."), []);
assert.deepEqual(riskyNumbers("Proxy to localhost:3000."), []);
assert.deepEqual(riskyNumbers("It handles 3000 requests per second."), ["3000"], "a count is not a port");
assert.deepEqual(riskyNumbers("It is 80% faster."), ["80"], "a percentage is not a port");
assert.deepEqual(riskyNumbers("Run on :3000, then load 3000 rows."), ["3000"], "one non-port use keeps it risky");
assert.deepEqual(riskyNumbers("Open :3000 and :3000 again."), [], "every occurrence a port is exempt");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/grounding-selfcheck.mjs`
Expected: FAIL on the first assertion — `[ '3000' ]` returned instead of `[]`.

- [ ] **Step 3: Implement the exemption in `riskyNumbers`**

Mirror the existing `everyOccurrenceIsVersion` shape in `checkGrounding`: for each candidate number, find every occurrence in the source text and return true (exempt) only when each one is preceded by `:` or by the word `port`. Drop exempt numbers from the returned list. Keep the existing year, money-stub, and small-count exemptions untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/grounding-selfcheck.mjs`
Expected: `grounding-selfcheck: ok`

- [ ] **Step 5: Commit**

```bash
git add scripts/grounding.mjs scripts/grounding-selfcheck.mjs
git commit -m "feat(grounding): exempt port numbers from risky figures"
```

---

### Task 3: Never fetch a non-citation in `blog-grounding.mjs`

**Files:**
- Modify: `scripts/blog-grounding.mjs` (`collectSources`, `groundArticle`'s repair re-scan)
- Test: `scripts/blog-grounding-selfcheck.mjs`

**Interfaces:**
- Consumes: `isCitationUrl` from Task 1.
- Produces: no signature change. `collectSources(links, fetcher)` and `groundArticle({...})` behave as before, minus non-citations.

- [ ] **Step 1: Write the failing test**

Append to `scripts/blog-grounding-selfcheck.mjs`:

```js
// An example hostname is not a citation: never fetched, never reported dead.
const seen = [];
const exampleOnly = await groundArticle({
  article: article("Limit is 512 MB."),
  links: ["https://a.test/doc", "http://rails_app", "http://$upstream/health"],
  signalUrl: null,
  callModel: async () => "",
  fetchSourceText: async (url) => { seen.push(url); return fakeFetch(url); },
});
assert.equal(exampleOnly.ok, true);
assert.deepEqual(seen, ["https://a.test/doc"], "non-citations must not be fetched");

// A repair that introduces an example hostname does not make it dead.
const repairExample = await groundArticle({
  article: article("Limit is 999 MB."),
  links: ["https://a.test/doc"],
  signalUrl: null,
  callModel: async () => "Limit is 512 MB. Start it with `docker compose up` and hit [the app](http://rails_app).",
  fetchSourceText: fakeFetch,
});
assert.equal(repairExample.ok, true);
assert.deepEqual(repairExample.deadSources, []);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/blog-grounding-selfcheck.mjs`
Expected: FAIL — `exampleOnly.ok` is `false` with `deadSources` containing `http://rails_app`.

- [ ] **Step 3: Filter in both places**

In `collectSources`, skip a link before calling the fetcher when `!isCitationUrl(url)`. In `groundArticle`, apply the same filter to the `cited` array built from `repairedBody` before it is passed to `collectSources`. Import `isCitationUrl` from `./grounding.mjs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/blog-grounding-selfcheck.mjs`
Expected: `blog-grounding-selfcheck: ok`

- [ ] **Step 5: Commit**

```bash
git add scripts/blog-grounding.mjs scripts/blog-grounding-selfcheck.mjs
git commit -m "fix(blog-grounding): skip example hostnames when collecting sources"
```

---

### Task 4: A non-citation cannot satisfy the citation requirement

**Files:**
- Modify: `scripts/blog-aeo.mjs` (`validateAeoGeo`, the `externalLinks` array)
- Test: `scripts/blog-aeo-selfcheck.mjs`

**Interfaces:**
- Consumes: `isCitationUrl` from Task 1.
- Produces: `validateAeoGeo(...).links` now contains only citations, so `groundArticle` receives only citations from the writers.

- [ ] **Step 1: Write the failing test**

Insert directly after the `resRails` assertions in `scripts/blog-aeo-selfcheck.mjs` (inside the same block, so `railsArticle` and `railsdevCfg` are in scope):

```js
  // An example hostname is not a primary source: the body must fail validation.
  const exampleCitation = validateAeoGeo(
    { ...railsArticle, body: makeEnValidBody({ external: "Start it with [the app](http://rails_app)." }) },
    railsdevCfg,
  );
  assert.equal(exampleCitation.ok, false);
  assert.ok(
    exampleCitation.bodyErrs.some((e) => e.startsWith("missing external primary-source citation")),
    exampleCitation.bodyErrs.join("; "),
  );
  assert.deepEqual(exampleCitation.links, []);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/blog-aeo-selfcheck.mjs`
Expected: FAIL — `ok` is `true` because `http://rails_app` counted as the external citation.

- [ ] **Step 3: Filter `externalLinks`**

In `validateAeoGeo`, add `.filter((u) => isCitationUrl(u))` to the `externalLinks` construction (after the existing own-domain filter). Import `isCitationUrl` from `./grounding.mjs`. Leave the `externalLinks.length < 1` error text unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/blog-aeo-selfcheck.mjs`
Expected: `blog-aeo-selfcheck: ok`

- [ ] **Step 5: Commit**

```bash
git add scripts/blog-aeo.mjs scripts/blog-aeo-selfcheck.mjs
git commit -m "fix(blog-aeo): require a real citation, not an example hostname"
```

---

### Task 5: `fixVoice` rewrites "our team" to first person

**Files:**
- Modify: `scripts/blog-aeo.mjs` (new export; called from `ensureRequiredLinks`)
- Test: `scripts/blog-aeo-selfcheck.mjs`

**Interfaces:**
- Produces: `fixVoice(body: string): string` — exported from `scripts/blog-aeo.mjs`. Called from `ensureRequiredLinks` only when `cfg.lang === "en"`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/blog-aeo-selfcheck.mjs`, and add `fixVoice` to the destructured import at the top:

```js
// --- fixVoice: solo sites say "I", and the verb after it agrees ---
for (const [input, want] of [
  ["Our team is hiring.", "I am hiring."],
  ["Our team builds Rails apps.", "I build Rails apps."],
  ["our team has shipped it.", "I have shipped it."],
  ["Our team relies on Postgres.", "I rely on Postgres."],
  ["Our team watches the queue.", "I watch the queue."],
  ["Our team uses Puma.", "I use Puma."],
  ["Our team focuses on latency.", "I focus on latency."],
  ["Our team maintains three gems.", "I maintain three gems."],
  ["Our team isn't a fan.", "I am not a fan."],
  ["Our developers are careful.", "I am careful."],
  ["Our engineers write tests.", "I write tests."],
  ["That is our team's approach.", "That is my approach."],
  ["Our team's been busy.", "I've been busy."],
]) {
  assert.equal(fixVoice(input), want, input);
}
// Fenced code is code, not prose.
assert.equal(
  fixVoice("Run it:\n```bash\n# our team runs this\n```\nOur team runs it."),
  "Run it:\n```bash\n# our team runs this\n```\nI run it.",
);
// Nothing to fix stays byte-identical.
assert.equal(fixVoice("I build Rails apps."), "I build Rails apps.");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/blog-aeo-selfcheck.mjs`
Expected: FAIL — `fixVoice is not a function`.

- [ ] **Step 3: Implement `fixVoice` and call it from `ensureRequiredLinks`**

`fixVoice` splits on `\n`, walks lines with the module's existing `scanLines` helper (already fence-aware), rewrites prose lines only, and rejoins. The rewrite matches `/\bour (team|developers|engineers)\b(['’]s)?/gi` and inspects the word that follows.

A suffix rule alone cannot handle this: "uses" → "use" and "focuses" → "focus" are both `-ses`, and no suffix test separates them. So: an explicit verb map first, suffix fallback second.

Verb map (keyed lowercase, value is the first-person form), covering what these writers actually say:

```
is/are→am   was/were→was   has→have   had→had   does→do   did→did
isn't/aren't→am not   hasn't/haven't→haven't   doesn't/don't→don't
uses→use   focuses→focus   relies→rely   maintains→maintain   builds→build
writes→write   runs→run   ships→ship   works→work   handles→handle
keeps→keep   helps→help   follows→follow   prefers→prefer   recommends→recommend
deploys→deploy   needs→need   wants→want   knows→know   gets→get   makes→make
takes→take   gives→give   spends→spend   manages→manage   reviews→review   tests→test
```

Fallback for verbs not in the map: `-ies` → `-y`; `-es` when the stem ends in `ss|sh|ch|x|z|o` → drop `es`; other trailing `s` (not `ss`) → drop `s`; anything else → the following word is left alone.

Possessive `['’]s` is handled before the verb: followed by `been|got` → `I've`, otherwise → `my`. Either way the following word is kept and re-emitted (`our team's approach` → `my approach`), because the match consumes it.

Replacement `I` is always capitalised; the following word keeps its original capitalisation.

Add a `shortcut:` comment naming the limit: a noun after "our team" ("our team members", "our team's tooling") is not reworded, and the `bannedPatterns` entry stays as the net for those.

In `ensureRequiredLinks`, run `fixVoice` on the input when `cfg.lang === "en"` before splitting into lines. Do not touch the `isId` path.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/blog-aeo-selfcheck.mjs`
Expected: `blog-aeo-selfcheck: ok`

- [ ] **Step 5: Commit**

```bash
git add scripts/blog-aeo.mjs scripts/blog-aeo-selfcheck.mjs
git commit -m "feat(blog-aeo): rewrite solo-site first-person voice before validation"
```

---

### Task 6: hendranicholas gets the solo-site ban

**Files:**
- Modify: `scripts/hendranicholas-blog-writer.mjs` (`validateArticle`'s `bannedPatterns`)
- Test: `scripts/hendranicholas-blog-selfcheck.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `scripts/hendranicholas-blog-selfcheck.mjs`, reusing the file's existing `base` article:

```js
// hendranicholas.com is one person: "our team" is a validation error.
const teamVoice = validateArticle({ ...base, body: base.body + "\n\nOur team builds these systems.\n" }, []);
assert.equal(teamVoice.ok, false);
assert.ok(teamVoice.errs.some((e) => e.startsWith('banned phrase "Our team"')), teamVoice.errs.join("; "));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/hendranicholas-blog-selfcheck.mjs`
Expected: FAIL — `ok` is `true`.

- [ ] **Step 3: Add the banned pattern**

In `validateArticle`, add the entry `[/\b(our team|our developers|our engineers)\b/i, 'hendranicholas.com is one developer: write "I"']` to `bannedPatterns`, next to the existing superlative entry.

**Ordering note:** Task 5's `fixVoice` runs inside `ensureRequiredLinks`, which the writer calls before `validateArticle`. A real article therefore never reaches this ban with "our team" in it — the ban catches only forms `fixVoice` cannot rewrite (e.g. "our team members"). The test below calls `validateArticle` directly, which is why it can still see the phrase.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/hendranicholas-blog-selfcheck.mjs`
Expected: passes, prints its ok line.

- [ ] **Step 5: Commit**

```bash
git add scripts/hendranicholas-blog-writer.mjs scripts/hendranicholas-blog-selfcheck.mjs
git commit -m "feat(hendranicholas): ban team voice on the solo blog"
```

---

### Task 7: Full verification and PR

**Files:** none modified.

- [ ] **Step 1: Run every self-check**

```bash
node scripts/grounding-selfcheck.mjs
node scripts/blog-grounding-selfcheck.mjs
node scripts/blog-aeo-selfcheck.mjs
node scripts/hendranicholas-blog-selfcheck.mjs
node scripts/published-selfcheck.mjs
node scripts/blog-topic-mix-selfcheck.mjs
node scripts/fullstackweb-category-selfcheck.mjs
node scripts/ai-providers-selfcheck.mjs
node scripts/site-index-selfcheck.mjs
npm run typecheck
```

Expected: every script prints its `ok` line; typecheck exits 0.

- [ ] **Step 2: Dry-run each blog workflow on the branch**

```bash
gh workflow run fullstackweb-blog-writer.yml -f dry_run=true
gh workflow run railsdev-blog-writer.yml -f dry_run=true
gh workflow run hendranicholas-blog-writer.yml -f dry_run=true
gh workflow run inasoft-blog-writer.yml -f dry_run=true
```

Expected: `inasoft` unchanged; the three English sites no longer skip on an example hostname or on "our team".

- [ ] **Step 3: Confirm no conflict markers, then open the PR**

```bash
git grep -n -E '^(<<<<<<< |>>>>>>> )' -- . ; echo "exit=$?"
```

Expected: no output (exit 1). Then open the PR with `## Summary`, `## What changed`, `## Verification` (the commands and their real outcomes), and `## Out of scope` (nginx sample decimals `0.12/0.20/0.30` still block; IG Reel untouched).
