# Align External Site `check_post.mjs` `seoTitle` Limits to 60 Chars

## Intent & Why
`cloudflare-ai-scheduler` enforces a uniform `seoTitle` length of **50–60 characters** across all four blog writers. In CI, `inasoft-blog-writer` and `railsdev-blog-writer` failed at `runSitePostCheck` because each site's `check_post.mjs` still rejects `seoTitle` over 50 (`inasoft-site`) or 49 (`railsdev-site`), even though all four Astro schemas (`src/content.config.ts`) already allow `seoTitle` up to 60 characters and all four blog `[slug].astro` pages already append the brand suffix (`| INASOFT`, `| RailsDev`, etc.).

## Goals & Non-Goals
- **Goals**:
  - Update `inasoft-site/.claude/skills/write-blog-article/scripts/check_post.mjs` to allow `seoTitle` up to **60** characters (instead of 50).
  - Update `railsdev-site/.claude/skills/write-blog-article/scripts/check_post.mjs` to allow `seoTitle` up to **60** characters (instead of 49).
  - Align `fullstackwebdev-site/scripts/check-post.mjs` to also validate `seoTitle` max **60** characters when present.
  - Open PRs on the affected external site repos and merge/verify them.
- **Non-Goals**:
  - Changing `src/content.config.ts` or blog `[slug].astro` layouts in any of the four site repos (already `max(60)` and already appending the brand suffix).
  - Changing `cloudflare-ai-scheduler` blog writer limits (already 50–60 chars).

## Constraints
- Astro blog `[slug].astro` pages continue appending the brand suffix (`| INASOFT`, `| ${site.name}`, etc.) to `seoTitle`.
- Changes to external site repos must land via PRs (not direct commits to `main`).

## Approaches
1. **Update `check_post.mjs` in the external site repos to `max 60` (Chosen)**: Matches the existing `z.string().max(60)` schemas and `cloudflare-ai-scheduler`'s 50–60 char rule.
2. **Restore per-site `seoTitle` limits (50 / 49) in `cloudflare-ai-scheduler`**: Rejected by the user; would undo the uniform 50–60 char spec.

## Design Summary
- `inasoft-site/.claude/skills/write-blog-article/scripts/check_post.mjs`: change `seoTitle` max check from `50` to `60`.
- `railsdev-site/.claude/skills/write-blog-article/scripts/check_post.mjs`: change `seoTitle` max check from `49` to `60` (and update the inline comment).
- `fullstackwebdev-site/scripts/check-post.mjs`: add `seoTitle` max `60` check when `data.seoTitle` is present.
- `hendranicholas-site`: no `check_post.mjs` script; schema and layout already match.
