# FullstackWeb blog writer category enum alignment — design

**Date:** 2026-11-18 · **Size:** small change

## Intent
Restore the `fullstackweb-blog-writer` workflow (`run 44208351258`) after `hendra/fullstackwebdev-site` (`#54`) tightened blog `category` from `z.string()` to a closed `z.enum(BLOG_CATEGORIES)`, which broke `astro build` on `superpowers-agentic-skills-framework.md` (`"AI/LLM"`) and left `scripts/fullstackweb-blog-writer.mjs` prompting for stale category names.

## Goals, non-goals, anti-goals
- **Goals:** Fix `superpowers-agentic-skills-framework.md` on `hendra/fullstackwebdev-site` so `main` builds cleanly; align `scripts/fullstackweb-blog-writer.mjs` prompts and validation with `BLOG_CATEGORIES` so generated posts never fail the enum check.
- **Non-goals:** Changing `BLOG_CATEGORIES` in `fullstackwebdev-site`, or modifying `railsdev-blog-writer.mjs` / `inasoft-blog-writer.mjs`.
- **Anti-goals:** Loosening `fullstackwebdev-site`'s schema back to `z.string()`, or letting unvalidated model output reach YAML frontmatter.

## Constraints
- `hendra/fullstackwebdev-site` `src/content.config.ts` requires `category` in:
  `AI Engineering | Backend | Frontend | Dev Tools | DevOps | Node.js and TypeScript | Python and FastAPI | Rust | Engineering Leadership`.
- All changes to `hendra/cloudflare-ai-scheduler` must land via PR (never commit directly to `main`).

## Approaches
- **1. Mirror `BLOG_CATEGORIES` + alias/keyword fallback (chosen)** — Add `CATEGORY_VALUES` in `scripts/fullstackweb-blog-writer.mjs` (matching `SERVICE_VALUES` and `scripts/inasoft-blog-writer.mjs`), update prompts, and map/fallback off-list model replies to a valid value. Simplest and zero parsing fragility; requires updating the constant if `BLOG_CATEGORIES` changes later.
- **2. Parse `BLOG_CATEGORIES` from `SITE_DIR/src/content.config.ts` at runtime** — Auto-syncs on site schema updates, but couples the script to TypeScript source syntax in another repo; unnecessary for a stable 9-item list.

## Design
1. **`hendra/fullstackwebdev-site` fix:** Open a PR updating `category: "AI/LLM"` to `category: "AI Engineering"` in `src/content/blog/superpowers-agentic-skills-framework.md` (and merge once checks pass).
2. **`scripts/fullstackweb-blog-writer.mjs`:**
   - Define `CATEGORY_VALUES` with the 9 `BLOG_CATEGORIES` entries.
   - Update `topicPrompt` and `fixPrompt` to instruct `CATEGORY_VALUES.join("|")`.
   - Replace the free-string `category` truncation in `validateArticle` with sanitization + alias mapping (e.g. `AI/LLM` → `AI Engineering`, `Web/Frontend` → `Frontend`, `Infra/DevOps` → `DevOps`, `Data` / `Ruby on Rails` → `Backend`) + keyword fallback matching `services` heuristics, defaulting to `"Dev Tools"`, guaranteeing `CATEGORY_VALUES.includes(a.category)`.
   - (`stubArticle` and the `AI_STUB` topic already use `"Node.js and TypeScript"`, which is in `CATEGORY_VALUES`.)

## Left to the builder
- Exact alias/keyword heuristic mapping inside `validateArticle`, adding a small verification check, and running `npm run typecheck` + a `dry_run=true` workflow dispatch once `hendra/fullstackwebdev-site` `main` is green.
