# Blog cover standard — design (2026-11-12)

## Intent and why

The blog writers currently generate covers with `scripts/make-cover.py` (Pillow, 1200×630, dark flat
card, title only). Those covers look nothing like the covers each site already ships:

| Site | How the site's own covers are made | Oldest-cover look | Size |
|---|---|---|---|
| railsdev.io | `scripts/blog-covers/<slug>.svg` → headless Chrome | red gradient `#d40000→#990000→#050505`, white glow top-left, left text block, right white-card diagram, `R` badge | 1600×900 PNG |
| inasoft.id | `scripts/assets/blog/<slug>.svg` → sharp | white bg + dot pattern, blue bar `#2383E2`, left text block, right pastel rounded-box diagram | 1600×900 JPG |
| fullstackweb.dev | `design/blog-covers/<slug>.html` → Chrome @2x | `#090d16` + grid, cyan/violet glows, horizontal 4-stage diagram with captions, **no title** | 2400×1260 PNG |

Every article the pipeline publishes gets a cover that breaks the site's visual system. Goal: new
pipeline covers follow each site's own oldest cover design, produced by **one standard mechanism**
(one AI content contract, one renderer, three per-site skins).

Note: both sites' `.claude/skills/write-blog-article/references/cover.md` are **stale** (they describe
dark `#090d16` for railsdev and `#0A0A0B` for inasoft). The real PNGs/SVGs are the source of truth.

## Goals / non-goals / anti-goals

**Goals**
- New covers match each site's oldest cover design: palette, layout, typography, size.
- One standard: same AI cover-spec contract, same renderer, three site skins.
- Deterministic output; no new npm dependencies; no change to site frontmatter or file paths.
- Site build keeps passing (`astro check && astro build`) — the cover is part of the pushed PR.

**Non-goals**
- Backfilling/regenerating the covers already published in the three sites (separate manual job).
- Updating the sites' own stale `cover.md` skill files (different repos, different owner).
- Unsplash photo covers — the pipeline stays illustration-only.

**Anti-goals**
- No AI image generation for covers (nondeterministic, unreliable text, cannot match the designs).
- No per-article hand-tuned SVG/HTML — every cover comes from the same templates.

## Constraints (verified 2026-11-12)

- Headless Chrome is available: locally `Google Chrome 157.0.8103.50`; on `ubuntu-latest` runners it
  is preinstalled — railsdev-site and fullstackwebdev-site both render their own covers this way.
- Fonts come from the **site checkout's** `node_modules` (already `npm ci`'d in CI): all three sites
  have `@fontsource-variable/inter`, railsdev additionally has `@fontsource/fira-code`. No new deps.
  Fallback: system sans-serif if the woff2 files are missing.
- Output sizes stay per site: railsdev 1600×900, inasoft 1600×900 PNG (site uses JPG; the pipeline
  already ships PNG today and astro accepts it), fullstackweb 2400×1260 (its template is 1200×630
  rendered at `--force-device-scale-factor=2`).
- Keep important content out of the top and bottom 30px (social crop to 1200×630).
- Pipelines stay deterministic and dependency-free (Node 20/22 stdlib + Chrome; Pillow goes away).

## Approaches considered

1. **Chrome + per-site template (chosen).** Pipeline writes the site's own source artifact
   (SVG for railsdev/inasoft, HTML for fullstackweb) from one AI cover spec, renders it with
   headless Chrome, commits the PNG. Closest to existing covers; one code path; no browser workarounds.
2. **Pillow rewrite.** Reimplement three templates in Python. No browser dependency, but gradients,
   glows, arrows and Inter metrics would drift from the site sources, and the code grows a lot.
3. **AI image generation** (Cloudflare Workers AI FLUX, already used by the IG reel pipeline).
   Attractive pictures, but nondeterministic, unreliable text, and it cannot reproduce the railsdev /
   inasoft designs at all.

## Design

### 1. Cover-spec contract (AI)

One extra AI call per article, after the body passes validation, at most 3 attempts (same retry
pattern as the body call). Failure to get a valid spec fails the run, like the body.

```jsonc
{
  "eyebrow": "RAILS PGVECTOR",            // ≤ 28 chars, uppercased by the template
  "title": "pgvector",                   // ≤ 30 chars (railsdev/inasoft only)
  "subtitle": ["Vector search in PostgreSQL", "with Rails and Neighbor"], // ≤ 42 chars each
  "bullets": ["Chunks embedded in a job", "HNSW with iterative scans", "Hybrid search with RRF"], // exactly 3, ≤ 34 chars
  "diagram": {
    "nodes": [
      { "label": "Document", "sub": "title + body", "kind": "card", "lines": ["embedding  vector(768)"] }
    ],                                     // 2–5 nodes; label ≤ 24 chars, sub ≤ 24 chars,
                                           // kind: "card" | "accent" | "hub"; lines: ≤ 2 mono code lines
    "edges": [[0, 1], [1, 2]]             // i < j, referencing nodes
  }
}
```

- railsdev + inasoft consume every field; fullstackweb consumes `diagram` only (diagram-only cover,
  decided with the owner: stay true to that site's oldest covers — see §5 for the open question).
- Language follows the article: English for railsdev/fullstackweb, Indonesian for inasoft.
- The spec prompt gets context: article title, keyword, the article's H2 section titles and the
  opening paragraph, so the diagram matches the article's subject.
- `coverAlt` in the frontmatter is derived from the spec: `"Diagram: A → B → C"` (the site skill
  asks `coverAlt` to describe the diagram, not the image). The topic call's free-text `coverAlt`
  stays as fallback.
- Validation is a pure function (`validateSpec`): rejects missing fields, over-long strings, wrong
  node/edge counts, unknown node kinds, out-of-range edge indices, and returns a normalised spec.

**Diagram fidelity (my call).** The hand-authored site covers draw bespoke artwork (tables with mono
code, numbered step lists, hub-and-spoke loops). The pipeline reproduces the **visual system** —
palette, type scale, card shapes, arrow style — with a per-article diagram built from the spec's
nodes, kinds and edges. `kind` covers the common shapes: `card` (plain box), `accent` (tinted
highlight box, the site's step marker), `hub` (circle node); `lines` renders mono code lines inside
a card. Bespoke per-article artwork stays out of scope — that is what "standard" buys us.

### 2. Templates (one per site, in the scheduler repo)

`scripts/cover/railsdev.mjs` — SVG, 1600×900, geometry copied from
`railsdev-site/scripts/blog-covers/rails-pgvector.svg`:
- bg linear gradient `#d40000` / `#990000` (0.45) / `#050505`; white radial glow (0.18, 0.12, r .75,
  opacity .28); blurred black ellipse bottom-right.
- Left column x=96: eyebrow 22px/600/letter-spacing 4, white 72%, y=250 · title 92px/800, y=352
  (auto-shrink to 640px) · bar 180×8 white, y=384 · subtitle 30px white 92%, y=458/500 · three
  bullets, dot r=8 at cy 582/634/686 (white / `#ffd2d2` / `#8f8f8f`), text 24px white 92% x=132.
- Right column x=760…1500: vertical chain of white cards (fill `#ffffff`, stroke `#d8d5d2` 2px,
  rx 18), label 24px/700 `#1c1a19`, sub 18px `#57534e`, arrows stroke `#c9c9c9` 2.5 with arrowhead
  marker; accent card fill `#fbedec` stroke `#cc0000` @0.55.
- Bottom right: `railsdev.io` (Fira Code 22px, white 75%, end-anchored x=1372 y=838) + 72×72 white
  rounded square at (1392, 800) with `R` 46px/800 `#cc0000`.

`scripts/cover/inasoft.mjs` — SVG, 1600×900, geometry copied from
`inasoft-site/scripts/assets/blog/ai-agent-adalah.svg`:
- bg `#FFFFFF` + 32px dot pattern (`#37352F` @0.05, r 1.5).
- Left column x=130: eyebrow 22px `#5B5A56` letter-spacing 5 y=250 · title 88px/700 `#37352F`
  letter-spacing -3 y=350 (auto-shrink) · bar 200×8 `#2383E2` y=380 · subtitle 32px `#4A4844`
  y=452/496 · three bullets, dots r=8 at cy 583/643/703 (`#2383E2` / `#8B5CF6` / `#0E9BB8`), text
  25px `#37352F` x=170.
- Right column x=800…1480: vertical chain of pastel rounded boxes — violet fill `#EFEBFC` stroke
  `#8B5CF6` label 22px/700 `#6D3BD1`; teal fill `#E5F7FA` stroke `#0E9BB8` label `#0E7490`; accent
  node circle fill `#E7F0FB` stroke `#2383E2` label 28px/700 `#1F66BE` + sub 19px `#5B5A56`;
  arrows stroke `#5B5A56` 3px with marker.

`scripts/cover/fullstackweb.mjs` — HTML with inline SVG, 1200×630 rendered @2x → 2400×1260,
geometry copied from `fullstackwebdev-site/design/blog-covers/production-rag-applications.html` +
`covers.css`:
- bg `#090d16` + 40px grid (`#1e293b` @0.45); radial glows `#38bdf8` @0.30 (left) and `#a855f7`
  @0.26 (right).
- Up to 4 stages left→right: tile fill `#0f172a` stroke `#334155` 1.5px rx 14, accent tile fill
  `#0c4a6e` stroke `#38bdf8` 2px, abstract inner bars `#334155` / `#7dd3fc`, caption 21px/600
  `#cbd5e1` centred below each stage, connector arrows stroke `#475569` 2px; final card gets the
  brand gradient border `#38bdf8→#818cf8→#c084fc`.
- No title text on the cover (site's own covers have none; the site renders the title beside it).

### 3. Renderer

`scripts/cover/render.mjs`:
1. Write the template output into `<site>/.cover-src/<slug>.<ext>` (temp dir inside the site
   checkout so the font `@font-face` path `../node_modules/...` resolves; not committed — the writers
   `git add` only `src/content/blog` and `src/assets/blog`).
2. Run Chrome: `google-chrome --headless=new --hide-scrollbars --no-sandbox --virtual-time-budget=3000
   [--force-device-scale-factor=2] --window-size=W,H --screenshot=<out>.png file://<src>`.
   Binary lookup order: `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`.
3. Verify the PNG header dimensions equal the expected size; delete the temp source.
4. Missing Chrome → clear failure message (no silent fallback to the old Pillow cover).

**Fonts.** Every template embeds `@font-face` for `@fontsource-variable/inter` (and
`@fontsource/fira-code` for railsdev's mono labels) pointing at the site checkout's `node_modules`
(`../node_modules/...`, exactly like the site repos do). If those files are missing the templates
fall back to a system sans stack. Consequence to note: inasoft's legacy covers were rasterised by
sharp/librsvg and therefore rendered in DejaVu Sans; new inasoft covers use Inter, which matches the
site's own UI font — layout and palette match the old covers, the typeface is the site's web font.

**Text fitting (my call).** SVG has no auto-shrink, so each template carries a small inline script
that measures the title/subtitle/bullet lines with `getComputedTextLength()` and lowers the font
size until the text fits its column. Chrome runs the script before the screenshot
(`--virtual-time-budget` makes that deterministic), so the fit is measured with the real font
metrics — one render pass, no width tables, no Node-side guessing.

`scripts/cover/spec.mjs` holds the prompt text + validation; `scripts/cover/selfcheck.mjs` is an
assert-based check (no framework): spec validation rejects bad specs, each template emits its
expected markers, and — when Chrome is present — renders one sample cover per site and checks the
PNG dimensions.

### 4. Writers and workflows

- `scripts/railsdev-blog-writer.mjs`, `scripts/inasoft-blog-writer.mjs`,
  `scripts/fullstackweb-blog-writer.mjs`: after body validation, call the AI for the cover spec,
  validate it, render the cover into `<site>/src/assets/blog/<slug>.png`, write the derived
  `coverAlt` into the frontmatter. `makeCover()` (Pillow) is replaced by `renderCover()`.
  The `AI_STUB=true` offline path gets a stub cover spec so the offline test still renders a cover.
- `scripts/make-cover.py` is deleted; the `pip3 install Pillow` step is removed from the three
  blog-writer workflows; a `google-chrome --version` step is added so a missing browser fails fast
  with a clear message.
- Frontmatter paths, site checksums and PR flow stay unchanged.

### 5. fullstackweb cover: title-less (resolved)

The owner's pick was "keep it diagram-only, like its oldest covers". A closer look at all 14
fullstackweb cover sources shows the site changed its mind later:

- 3 sources are title-less — the oldest ones (`production-rag-applications`,
  `integrate-llms-into-web-applications`, `nodejs-release-schedule-one-lts-per-year`), and the one
  the design cites.
- 11 sources carry a 58px/800 title + 24px subtitle + 22px footer line above the stage cards
  (`django-vs-fastapi`, `python-3-15-lazy-imports`, `temporal-api-nodejs-26`,
  `typescript-7-migration-guide`, …). These are the newer covers.

So "match the oldest cover" (title-less) and "match what the site publishes today" (title-bearing)
point different ways for this one site. **Resolved 2026-11-13: the owner confirmed title-less,
diagram-only** — matches the 3 oldest covers.

Related, smaller: fullstackweb's covers rotate accent colours (green `#6ee7b7`, amber `#fde68a`,
mint `#bbf7d0`, sky `#0ea5e9`, cyan/violet). My call: keep the fixed brand cyan `#38bdf8` + violet
`#a855f7` from the site's own palette, so the pipeline stays one template. A per-article accent
would add an `accent` field to the spec, an allowed-palette list to the validator, and a rule to
the prompt.

### 6. Files

| File | Change |
|---|---|
| `scripts/cover/spec.mjs` | new — prompt + validation/normalisation |
| `scripts/cover/railsdev.mjs` | new — SVG template |
| `scripts/cover/inasoft.mjs` | new — SVG template |
| `scripts/cover/fullstackweb.mjs` | new — HTML template |
| `scripts/cover/render.mjs` | new — Chrome runner |
| `scripts/cover/selfcheck.mjs` | new — asserts + optional live render |
| `scripts/make-cover.py` | deleted |
| the three blog writers | cover-spec call + `renderCover()` + derived `coverAlt` |
| the three blog-writer workflows | drop Pillow, add Chrome check |
| `package.json` | `npm run cover:selfcheck` |
| `AGENTS.md`, `README.md`, `docs/status.md` | cover pipeline documentation |

## Calls I made (owner can override)

- PNG for every site (inasoft's own covers are JPG, but astro accepts PNG and the pipeline already
  ships PNG — no frontmatter change).
- Per-site native sizes instead of one uniform 1600×900.
- A dedicated cover-spec AI call after the body, instead of folding it into the topic JSON, so the
  cover work cannot disturb the article validation gates.
- **Failure policy:** the cover-spec call is retried up to 3 times like the body call; if it still
  returns no valid spec the run fails with a Slack note and no PR. A published article without a
  valid cover would break the site build or ship an off-brand cover, so the run stops instead.
- Vertical chain layout for the railsdev/inasoft diagrams, horizontal stages for fullstackweb.
- Title auto-shrink to the column width, because font metrics differ per machine.
- No backfill of the covers already published.

## Verification

1. `node scripts/cover/selfcheck.mjs` — spec validation + template markers; with Chrome present it
   renders one sample per site and asserts the PNG dimensions.
2. Visual check: view the three rendered samples next to each site's oldest cover.
3. `npm run typecheck` (covers `src/**/*.ts` only — unaffected) and YAML parse of the workflows.
4. `dry_run=true` dispatch of all three blog-writer workflows: each must reach the site build and
   pass it (`astro check && astro build`).

## Out of scope

- Regenerating the covers already in the three sites.
- Fixing the stale `cover.md` skill specs inside the site repos.
- Any change to the IG reel or digest pipelines.
