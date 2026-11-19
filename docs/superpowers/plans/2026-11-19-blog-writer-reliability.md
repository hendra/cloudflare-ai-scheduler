# Blog writer reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three blog writers stop failing on length and missing-link validation errors.

**Architecture:** Deterministic link/fence fixes and an expand-not-discard body loop live in the shared `scripts/blog-aeo.mjs`; `callModel` gains a per-call preferred-model list; each writer swaps its inline body loop for the shared one and skips cleanly when the body stays short.

**Tech Stack:** Node 22 ESM, zero deps, assert-based self-checks.

**Spec:** `docs/superpowers/specs/2026-11-19-blog-writer-reliability-design.md`

## Global Constraints
- `MIN_BODY_WORDS` stays 1500; validator rules unchanged.
- Short after expansion → Slack note + `process.exit(0)`, nothing published.
- Only add a source link to the signal page when its text was fetched (non-empty `signalSource`).
- Inserted text is English for railsdev/fullstackweb, Indonesian for inasoft; fullstackweb links keep trailing slashes.
- No new dependencies; typecheck scope unchanged.

## Review Focus
- Body already has the service/contact/source link → nothing added, body byte-identical.
- Fence inside a fence (```` ```` ```` / tilde) or an untagged *closing* fence → only opening fences get `text`.
- Body without a Conclusion heading → links appended at the end (validator still reports the missing heading).
- Absolute `https://<domain>/x` links → become `/x`, external links untouched.
- Preferred model 429 / timeout → falls through to the normal chain, never throws early.

---

### Task 1: `ensureRequiredLinks` in blog-aeo

**Files:** Modify `scripts/blog-aeo.mjs`; Test `scripts/blog-aeo-selfcheck.mjs`

**Produces:** `ensureRequiredLinks(body: string, cfg: { domain, lang, serviceHref, contactHref, contactLabel?, sourceUrl?, conclusionHeading }) -> string`

- [ ] Step 1: self-check asserts — body missing all three links gains `](serviceHref)`, `](contactHref)`, `](sourceUrl)` inside the Conclusion section and `validateAeoGeo` no longer reports `service link`, `CTA link`, `internal links`, `external primary-source`; untagged opening fence becomes ```` ```text ```` while its closing fence stays bare; a fully linked body is returned unchanged; `](https://railsdev.io/blog/x)` → `](/blog/x)`; `contactLabel: "Konsultasi Gratis"` appears in output.
- [ ] Step 2: `npm run aeo:selfcheck` → FAIL (not exported).
- [ ] Step 3: implement; fence-aware line scan identical to validator's; one added paragraph before the next `## ` after the conclusion heading (or end of body).
- [ ] Step 4: `npm run aeo:selfcheck` → PASS. Commit.

### Task 2: `generateBody` (expand, don't discard)

**Files:** Modify `scripts/blog-aeo.mjs`; Test `scripts/blog-aeo-selfcheck.mjs`

**Produces:** `generateBody({ callModel: (prompt) => Promise<string>, prompt: string, minWords: number, attempts = 3 }) -> Promise<{ body: string|null, words: number }>` — strips a wrapping ```` ```markdown ```` fence; on a short draft the next prompt is the original prompt + the draft + "expand to at least N words, keep every section and link"; keeps the longest draft; a throwing call counts as an attempt.

- [ ] Step 1: asserts with a stub `callModel` returning 800 then 1600 words → `body` is the 1600-word text and the 2nd prompt contains the first draft; stub always 800 → `{ body: null, words: 800 }`; stub throws once then 1600 → body returned.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS. Commit.

### Task 3: preferred models in `callModel`

**Files:** Modify `scripts/ai-providers.mjs`; Test `scripts/ai-providers-selfcheck.mjs`

**Produces:** `export const LONGFORM_MODELS = [{ provider: "groq", model: "qwen/qwen3.8-27b" }, { provider: "gemini", model: "gemma-4-31b-it", timeoutMs: 240000 }]`; `callModel(prompt, { prefer?: Array<{provider, model, timeoutMs?}> })` tries each preferred entry (skipped without credentials) before `providerChain()`; extract the per-attempt fetch into `tryProvider(name, model, timeoutMs, payloadOpts)` so both loops share it.

- [ ] Step 1: asserts with a stubbed global `fetch`: prefer entry answering 200 → its model id is in the request body and chain is not called; prefer entry 500 → falls through to the chain provider; prefer entry without key → skipped; `LONGFORM_MODELS` exact values above.
- [ ] Step 2: `npm run selfcheck` → FAIL. Step 3: implement. Step 4: PASS. Commit.

### Task 4: wire the three writers + workflows

**Files:** Modify `scripts/{railsdev,fullstackweb,inasoft}-blog-writer.mjs`, `.github/workflows/{railsdev,fullstackweb,inasoft}-blog-writer.yml`, `AGENTS.md`, `docs/status.md`

- [ ] Step 1: in each writer, replace the first-draft loop and the feedback-retry loop with `generateBody` using `callModel(p, { maxTokens: 8000, expectJSON: false, prefer: LONGFORM_MODELS })`; pass every body (draft, retry, grounding-repaired) through `ensureRequiredLinks` with the site's `servicePathFor`, contact href, `contactLabel` (inasoft `"Konsultasi Gratis"`), `sourceUrl: signalSource ? chosenSignal.url : null`.
- [ ] Step 2: `body === null` (first draft or retry) → Slack note "skipped — article too short (N words)" + `process.exit(0)`; other validation failures keep `fail()`.
- [ ] Step 3: workflows: `AI_FALLBACKS: openrouter,groq,gemini,kilo,cloudflare`, `AI_PROVIDER: groq`, `timeout-minutes: 45`. Docs: AI chain line + gotcha.
- [ ] Step 4: `npm run typecheck && npm run aeo:selfcheck && npm run selfcheck && npm run blog:grounding:selfcheck && npm run grounding:selfcheck && npm run published:selfcheck`; `AI_STUB=true DRY_RUN=true` run of each writer against a local site checkout if available → all PASS. Commit.
- [ ] Step 5: PR, then `gh workflow run <writer> -f dry_run=true` for all three → each run green (written + validated, or a clean skip with reason in log).
