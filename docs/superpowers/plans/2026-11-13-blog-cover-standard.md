# Blog Cover Standard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Pillow cover (`scripts/make-cover.py`) with per-site Chrome-rendered covers that match each site's oldest cover design, from one AI cover-spec contract.

**Architecture:** `scripts/cover/spec.mjs` builds the cover-spec prompt and validates the AI's JSON. Three pure template functions (`spec → SVG/HTML string`) reproduce each site's design. `scripts/cover/render.mjs` writes the source into the site checkout, screenshots it with headless Chrome, and checks the PNG size. The three blog writers call one `renderCover()`.

**Tech Stack:** Node 22 stdlib (ESM), headless Google Chrome, inline SVG; fonts from the site checkout's `node_modules`.

**Spec:** `docs/superpowers/specs/2026-11-12-blog-cover-standard-design.md`

## Global Constraints

- No new npm deps; no Pillow; Node stdlib + `google-chrome` only.
- Sizes: railsdev 1600×900, inasoft 1600×900, fullstackweb 1200×630 @ `--force-device-scale-factor=2` = 2400×1260. Output always PNG at `<site>/src/assets/blog/<slug>.png`.
- Nothing important within 30px of top/bottom edges.
- fullstackweb cover is **title-less, diagram-only** (owner, 2026-11-13); accents fixed cyan `#38bdf8` / violet `#a855f7`.
- Spec limits: eyebrow ≤ 28, title ≤ 30, subtitle exactly 2 lines ≤ 42, bullets exactly 3 ≤ 34, nodes 2–5, node label ≤ 24, sub ≤ 24, `kind ∈ {card, accent, hub}`, `lines` ≤ 2 items ≤ 32, edges `[i, j]` with `0 ≤ i < j < nodes.length`.
- Cover-spec call: ≤ 3 attempts; no valid spec → `fail()` (Slack note, no PR).
- All text XML-escaped before entering SVG/HTML.
- Never commit to `main`; branch `feat/blog-cover-standard`, PR.

## Review Focus

- Titles/labels containing `&`, `<`, `"` (e.g. "R&D", "Vec<T>") — must render literally, not break the SVG → test in Task 1 (`escapeXml`) and Task 2 (template contains `&amp;`).
- AI returns spec wrapped in prose / code fences, or lengths over the limit by a few chars — `parseCoverSpec` extracts the JSON object; over-length strings are **clamped at a word boundary**, not rejected (rejecting forces a whole retry for a cosmetic issue); structural errors (bullet count, node count, bad edges, kind) are rejected → Task 1.
- Long title like "Active Record Encryption" at 92px overflows the left column — inline fit script shrinks it → Task 3 visual check with a long-title sample.
- Chrome missing / exits non-zero / writes no PNG — `renderCover` throws a clear `Error` (writer turns it into `fail()`) → Task 3.
- Indonesian text with diacritics / long words — inasoft sample in Task 3 uses Indonesian strings.

---

### Task 1: Cover-spec contract (`spec.mjs`)

**Files:**
- Create: `scripts/cover/spec.mjs`
- Create: `scripts/cover/selfcheck.mjs` (assert-based; grows in Tasks 2–3)
- Modify: `package.json` — add `"cover:selfcheck": "node scripts/cover/selfcheck.mjs"`

**Interfaces:**
- Produces:
  - `escapeXml(s: string): string` — escapes `& < > " '`.
  - `coverSpecPrompt({ site: "railsdev"|"inasoft"|"fullstackweb", title, keyword, body }): string` — includes title, keyword, H2 titles (`^## ` lines of body) and the first paragraph (≤ 600 chars); asks for ONLY the JSON shape from spec §1; tells inasoft to write Indonesian; tells fullstackweb only `diagram` is drawn (other fields still required, keeps one contract).
  - `parseCoverSpec(raw: string): { ok: true, spec } | { ok: false, errs: string[] }` — extracts first `{…}`, validates, clamps lengths, normalises `kind` default `"card"`, `lines` default `[]`.
  - `coverAltFromSpec(spec): string` — `"Diagram: " + node labels joined " → "`.
  - `STUB_SPEC` — a valid spec for `AI_STUB=true`.

- [ ] **Step 1: Write failing asserts in `scripts/cover/selfcheck.mjs`**

```js
import assert from "node:assert/strict";
import { escapeXml, parseCoverSpec, coverAltFromSpec, coverSpecPrompt, STUB_SPEC } from "./spec.mjs";
const good = { eyebrow: "rails pgvector", title: "pgvector", subtitle: ["Vector search in PostgreSQL", "with Rails"], bullets: ["a", "b", "c"], diagram: { nodes: [{ label: "Document", sub: "title + body" }, { label: "Embed job", kind: "accent" }, { label: "Chunks", lines: ["embedding vector(768)"] }], edges: [[0, 1], [1, 2]] } };
assert.equal(escapeXml(`R&D <x> "q"`), "R&amp;D &lt;x&gt; &quot;q&quot;");
let r = parseCoverSpec("Sure!\n```json\n" + JSON.stringify(good) + "\n```");
assert.equal(r.ok, true); assert.equal(r.spec.diagram.nodes[0].kind, "card"); assert.deepEqual(r.spec.diagram.nodes[0].lines, []);
r = parseCoverSpec(JSON.stringify({ ...good, title: "A very long cover title that is way past thirty" }));
assert.equal(r.ok, true); assert.ok(r.spec.title.length <= 30);
assert.equal(parseCoverSpec(JSON.stringify({ ...good, bullets: ["a", "b"] })).ok, false);
assert.equal(parseCoverSpec(JSON.stringify({ ...good, diagram: { ...good.diagram, edges: [[2, 1]] } })).ok, false);
assert.equal(parseCoverSpec(JSON.stringify({ ...good, diagram: { nodes: [good.diagram.nodes[0]], edges: [] } })).ok, false);
assert.equal(parseCoverSpec(JSON.stringify({ ...good, diagram: { ...good.diagram, nodes: [{ label: "x", kind: "blob" }, good.diagram.nodes[1]] } })).ok, false);
assert.equal(parseCoverSpec("no json here").ok, false);
assert.equal(coverAltFromSpec(r.spec), "Diagram: Document → Embed job → Chunks");
assert.match(coverSpecPrompt({ site: "inasoft", title: "T", keyword: "k", body: "Intro.\n\n## Satu\n\n## Dua" }), /Indonesia[n]?/i);
assert.match(coverSpecPrompt({ site: "railsdev", title: "T", keyword: "k", body: "Intro.\n\n## One\n\n## Two" }), /One[\s\S]*Two/);
assert.equal(parseCoverSpec(JSON.stringify(STUB_SPEC)).ok, true);
console.log("cover self-check: ok");
```

- [ ] **Step 2: Run** `node scripts/cover/selfcheck.mjs` — Expected: FAIL `Cannot find module …/spec.mjs`.
- [ ] **Step 3: Implement `scripts/cover/spec.mjs`** per Interfaces; clamp with a word-boundary cut (reuse the `clampAtWord` approach from the writers, local copy).
- [ ] **Step 4: Run** `node scripts/cover/selfcheck.mjs` — Expected: `cover self-check: ok`.
- [ ] **Step 5: Commit** `git add scripts/cover package.json && git commit -m "feat(cover): cover-spec contract and validation"`

---

### Task 2: Site templates

**Files:**
- Create: `scripts/cover/templates.mjs` (one file, three exported functions + shared helpers — they change together)
- Modify: `scripts/cover/selfcheck.mjs`

**Interfaces:**
- Consumes: `escapeXml`, normalised spec from Task 1.
- Produces: `TEMPLATES: Record<"railsdev"|"inasoft"|"fullstackweb", { ext: "svg"|"html", width: number, height: number, scale: 1|2, render(spec): string }>`
  - railsdev `{ ext: "svg", width: 1600, height: 900, scale: 1 }`, inasoft same, fullstackweb `{ ext: "html", width: 1200, height: 630, scale: 2 }`.

Geometry and colours: copy verbatim from spec §2 (railsdev from `railsdev-site/scripts/blog-covers/rails-pgvector.svg`, inasoft from `inasoft-site/scripts/assets/blog/ai-agent-adalah.svg`, fullstackweb from `fullstackwebdev-site/design/blog-covers/production-rag-applications.html` + `covers.css`; fetch with `gh api repos/hendra/<repo>/contents/<path> --jq .content | base64 -d`).

Diagram layout:
- railsdev/inasoft: nodes stacked vertically in the right column (x 760–1500 railsdev, 800–1480 inasoft), y from 96 to 780, equal height, gap for arrows; edge `[i,i+1]` = straight vertical arrow, non-adjacent edge = elbow arrow on the right side. `accent` → tinted box, `hub` → railsdev accent box with heavier stroke / inasoft circle node, `lines` → Fira Code (railsdev) / Inter mono-ish 19px rows inside the card.
- fullstackweb: nodes as horizontal stages across 1200 width (first ≤ 4 nodes; a 5th is dropped for this skin), each stage a tile with abstract bars (`card`), highlighted tile (`accent`), or dot-cloud circle with hub (`hub`); caption = `label` 21px/600 `#cbd5e1` at y=490; arrows `#475569` between consecutive stages; last stage gets brand-gradient border. No title/eyebrow/bullets text.
- Fonts: `@font-face` Inter Variable from `../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2` (railsdev also Fira Code `../node_modules/@fontsource/fira-code/files/fira-code-latin-400-normal.woff2`); source file sits one level under the site root (`<site>/.cover-src/`).
- Fit script (railsdev/inasoft): inline `<script>` in the SVG; for every `text[data-fit]` with `data-max="<px width>"`, while `getComputedTextLength() > max` decrease `font-size` by 2 (floor 20); run after `document.fonts.ready`.

- [ ] **Step 1: Add failing asserts**

```js
import { TEMPLATES } from "./templates.mjs";
const amp = parseCoverSpec(JSON.stringify({ ...good, title: "R&D Ops" })).spec;
for (const [site, t] of Object.entries(TEMPLATES)) {
  const out = t.render(amp);
  assert.ok(out.includes("Document"), `${site}: node label`);
  assert.ok(!/R&D/.test(out), `${site}: raw ampersand leaked`);
}
assert.match(TEMPLATES.railsdev.render(amp), /#d40000[\s\S]*railsdev\.io[\s\S]*>R</);
assert.match(TEMPLATES.railsdev.render(amp), /R&amp;D Ops/);
assert.match(TEMPLATES.inasoft.render(amp), /#2383E2[\s\S]*R&amp;D Ops/);
assert.match(TEMPLATES.fullstackweb.render(amp), /#090d16/);
assert.ok(!TEMPLATES.fullstackweb.render(amp).includes("R&amp;D Ops"), "fullstackweb is title-less");
assert.deepEqual([TEMPLATES.fullstackweb.width, TEMPLATES.fullstackweb.scale], [1200, 2]);
```

- [ ] **Step 2: Run** `npm run cover:selfcheck` — Expected: FAIL module not found.
- [ ] **Step 3: Implement `scripts/cover/templates.mjs`.**
- [ ] **Step 4: Run** `npm run cover:selfcheck` — Expected: ok.
- [ ] **Step 5: Commit** `git commit -am "feat(cover): railsdev, inasoft and fullstackweb templates"` (add the new file first).

---

### Task 3: Chrome renderer + visual verification

**Files:**
- Create: `scripts/cover/render.mjs`
- Modify: `scripts/cover/selfcheck.mjs`

**Interfaces:**
- Consumes: `TEMPLATES`.
- Produces: `renderCover({ site, spec, siteDir, outPath }): void` — writes `<siteDir>/.cover-src/<basename>.<ext>`, runs the first found of `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser` (`execFileSync`, 60s timeout) with `--headless=new --hide-scrollbars --no-sandbox --virtual-time-budget=3000 --window-size=W,H [--force-device-scale-factor=2] --screenshot=<outPath> file://<abs src>`, removes `.cover-src/`, then reads the PNG IHDR (bytes 16–23) and throws `Error("cover: expected WxH, got …")` on mismatch. No Chrome → `Error("cover: headless Chrome not found (google-chrome/chromium)")`. Also exports `pngSize(path): [w, h]` and `findChrome(): string|null`.

- [ ] **Step 1: Add asserts** — `pngSize` on a hand-built 24-byte IHDR buffer written to `/tmp`; then, `if (findChrome())`, render all three sites with `good` plus a long-title railsdev spec ("Active Record Encryption Keys") and an Indonesian inasoft spec into `/tmp/opencode/cover-samples/<site>.png` with `siteDir` = a temp dir, asserting sizes 1600×900 / 1600×900 / 2400×1260; else log `chrome not found: render skipped`.
- [ ] **Step 2: Run** — Expected FAIL (module not found).
- [ ] **Step 3: Implement `scripts/cover/render.mjs`.**
- [ ] **Step 4: Run** `npm run cover:selfcheck` — Expected: ok, three PNGs written.
- [ ] **Step 5: Visual check** — Read each sample PNG next to `/tmp/opencode/covers/railsdev-oldest.png`, an inasoft legacy JPG (`gh api` `src/assets/blog/ai-agent-adalah.jpg`), and `/tmp/opencode/covers/fullstack-oldest.png`. Pass = same palette/layout, no clipped or overlapping text, long title fits, nothing in top/bottom 30px. Re-render against a real site checkout (`gh repo clone hendra/railsdev-site /tmp/opencode/rd -- --depth 1 && npm ci --prefix /tmp/opencode/rd --ignore-scripts`) to confirm Inter loads (not fallback). Iterate on templates until clean.
- [ ] **Step 6: Commit** `git commit -m "feat(cover): headless Chrome renderer"`.

---

### Task 4: Wire into the three writers, remove Pillow

**Files:**
- Modify: `scripts/railsdev-blog-writer.mjs` (header comment line 8; `makeCover` 159–162; cover step 294–296)
- Modify: `scripts/inasoft-blog-writer.mjs` (line 8; `makeCover` ~262; cover step ~431)
- Modify: `scripts/fullstackweb-blog-writer.mjs` (line 8; `makeCover` ~193; cover step ~341)
- Modify: `.github/workflows/{railsdev,inasoft,fullstackweb}-blog-writer.yml` — replace "Install Pillow" step with `- name: Check headless Chrome` / `run: google-chrome --version`
- Delete: `scripts/make-cover.py`

**Interfaces:**
- Consumes: `coverSpecPrompt`, `parseCoverSpec`, `coverAltFromSpec`, `STUB_SPEC`, `renderCover`.

Each writer: delete `makeCover`; at the cover step (after link check, before writing `.md`):
1. `spec = AI_STUB ? STUB_SPEC : ` up to 3 `callModel(coverSpecPrompt({ site, title, keyword, body }) + retryHint, { maxTokens: 2048 })` attempts through `parseCoverSpec`; retry hint lists the previous `errs`.
2. No spec → `await fail("cover spec generation failed after 3 attempts: <last errs>")`.
3. `article.coverAlt = coverAltFromSpec(spec)`.
4. `try { renderCover({ site, spec, siteDir: SITE_DIR, outPath: coverPath }) } catch (e) { await fail(e.message); return; }`.

- [ ] **Step 1:** Edit the three writers + workflows; `git rm scripts/make-cover.py`; `grep -rn "make-cover\|Pillow" scripts .github README.md AGENTS.md docs/status.md` → only doc hits remain (fixed in Task 5).
- [ ] **Step 2: Offline run per site** — `AI_STUB=true DRY_RUN=true SITE_DIR=/tmp/opencode/<clone> node scripts/<site>-blog-writer.mjs` (clones via `gh repo clone hendra/<repo> -- --depth 1`, `npm ci`/`pnpm i` in each). Expected: `cover generated:` and `build passed` for all three; view each generated PNG.
- [ ] **Step 3:** `node --check` each writer, `npm run selfcheck`, `npm run cover:selfcheck`, `npm run typecheck`, YAML parse of the 3 workflows — all pass.
- [ ] **Step 4: Commit** `git commit -am "feat(cover): blog writers render site-standard covers with Chrome"`.

---

### Task 5: Docs, PR, live dry runs

**Files:**
- Modify: `AGENTS.md` (Pipelines bullet: replace "Cover generation shared via `scripts/make-cover.py`…" with `scripts/cover/` + Chrome), `README.md` (cover mention, if any), `docs/status.md` (new gotcha: covers rendered by headless Chrome from `scripts/cover/templates.mjs`; site `cover.md` skills are stale; fullstackweb title-less by owner decision).

- [ ] **Step 1:** Edit docs; `git grep -n -E '^(<<<<<<< |>>>>>>> )' -- .` clean; commit `docs: blog cover standard`.
- [ ] **Step 2:** Push `feat/blog-cover-standard`, open PR (Summary / What changed / Verification / Out of scope, link spec + plan).
- [ ] **Step 3:** `gh workflow run <site>-blog-writer.yml --ref feat/blog-cover-standard -f dry_run=true` ×3 — Expected: success, logs show `cover generated:` and `build passed`. Record run IDs in the PR Verification section.
