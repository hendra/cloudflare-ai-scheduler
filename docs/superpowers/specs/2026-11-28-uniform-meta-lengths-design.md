# Uniform `seoTitle` and `description` Lengths Across Blog Writers

## Intent & Why
Enforce consistent SEO metadata lengths across all four blog writer pipelines (`railsdev`, `inasoft`, `fullstackweb`, `hendranicholas`) so every generated article has a SERP-ready `seoTitle` (50–60 characters) and `description` (120–160 characters).

## Goals & Non-Goals
- **Goals**:
  - Uniform `seoTitle` length of **50–60 characters** across all 4 blog writers, including adding `seoTitle` to `fullstackweb-blog-writer.mjs` and `hendranicholas-blog-writer.mjs`.
  - Uniform `description` length of **120–160 characters** across all 4 blog writers (removing the `180` override in `fullstackweb` and `hendranicholas`).
  - Centralize defaults and validation in `scripts/blog-aeo.mjs` (`seoTitleMin = 50`, `seoTitleMax = 60`, `descMin = 120`, `descMax = 160`).
  - Update self-check tests (`scripts/blog-aeo-selfcheck.mjs`, `scripts/hendranicholas-blog-selfcheck.mjs`, and any stub fixtures) to match.
- **Non-Goals**:
  - Modifying the external Astro site repositories (`inasoft-site`, `railsdev`, `fullstackweb`, `hendranicholas`) — their content collection schemas and layouts must be updated separately to accept `seoTitle` up to 60 characters.
  - Changing `title` (H1) length rules (`20–120` characters).

## Constraints
- `inasoft-site` previously enforced `seoTitle.max(50)` and `railsdev` had `seoTitleMax: 49`; `fullstackweb` and `hendranicholas` did not have `seoTitle` in frontmatter. Until those external Astro schemas/layouts are updated, `astro build` in CI may reject `seoTitle > 50` or unknown `seoTitle` fields.
- Truncating `seoTitle` or `description` with `clampAtWord` can drop lengths below the minimum (`50` or `120`), so length violations must flow through `validateAeoGeo` + the `fixPrompt` AI repair loop rather than silent truncation below the minimum.

## Approaches Considered
1. **Full centralization in `blog-aeo.mjs` (Chosen)**: Set `seoTitleMin = 50`, `seoTitleMax = 60`, `descMin = 120`, `descMax = 160` as the single standard in `blog-aeo.mjs` and align all 4 writers + frontmatter + prompts + `fixPrompt` + stubs. Cleanest, zero branching rules.
2. **Gradual per-site overrides**: Support `seoTitleMin`/`seoTitleMax` overrides per writer until external Astro repos are updated. Rejected because it leaves temporary divergence that must be cleaned up later.

## Design Summary
- **`scripts/blog-aeo.mjs`**:
  - In `validateAeoGeo`, validate `seoTitle` against `seoTitleMin` (default `50`) and `seoTitleMax` (default `60`) whenever `seoTitle` is required (default `true` or enabled for all 4 writers), emitting a meta error matching `META_ERR_RE` (e.g., `seoTitle ${len} not in ${min}-${max}`).
  - Keep `descMin` (`120`) and `descMax` (`160`) defaults.
- **All 4 writers** (`railsdev-blog-writer.mjs`, `inasoft-blog-writer.mjs`, `fullstackweb-blog-writer.mjs`, `hendranicholas-blog-writer.mjs`):
  - Include `"seoTitle"` in prompt JSON schemas (`"50-60 chars"`), `META_KEYS`, `fixPrompt` constraints (`seoTitle: 50-60 chars`, `description: 120-160 chars`), stub objects, and YAML frontmatter output.
  - Remove per-writer `DESC_MAX_CHARS = 180` (`fullstackweb`, `hendranicholas`), `SEO_TITLE_MAX = 50` (`inasoft`), `seoTitleMax: 49` (`railsdev`), and silent `clampAtWord` truncation on `seoTitle`/`description` that could push them below `50`/`120`.
- **Self-checks**:
  - Update `scripts/blog-aeo-selfcheck.mjs` and `scripts/hendranicholas-blog-selfcheck.mjs` to test `seoTitle` `50–60` and `description` `120–160` bounds.
