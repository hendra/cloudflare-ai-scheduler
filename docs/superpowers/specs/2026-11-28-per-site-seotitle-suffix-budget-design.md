# Per-Site `seoTitle` Length Budget (<= 60 Chars Including Brand Suffix)

## Intent & Why
Every site appends its own `" | <Brand>"` suffix to `seoTitle` in its blog `[slug].astro` layout. Enforcing a uniform `50–60` char `seoTitle` caused rendered `<title>` tags to exceed `60` characters (`64` chars on INASOFT, failing `inasoft-site/scripts/seo-audit.mjs`). Giving each blog writer and site `check_post` script a `seoTitle` budget of `(50 - suffixLen)..(60 - suffixLen)` keeps every rendered `<title>` at **50–60 characters** in search results.

## Site Budgets
| Site | Suffix (`" \| <Brand>"`) | Suffix Len | `seoTitle` Min–Max | Rendered `<title>` |
| --- | --- | --- | --- | --- |
| `inasoft` | `" \| INASOFT"` | 10 | **40–50** | 50–60 |
| `railsdev` | `" \| RailsDev"` | 11 | **39–49** | 50–60 |
| `fullstackweb` | `" \| Full-Stack Web Dev"` | 21 | **29–39** | 50–60 |
| `hendranicholas` | `" \| Hendra Nicholas"` | 18 | **32–42** | 50–60 |

## Goals & Non-Goals
- **Goals**:
  - Update all four blog writers (`inasoft-blog-writer.mjs`, `railsdev-blog-writer.mjs`, `fullstackweb-blog-writer.mjs`, `hendranicholas-blog-writer.mjs`) to pass their site's `seoTitleMin` / `seoTitleMax` to `validateAeoGeo`, and update their topic-picker prompts, `repairMetadata` prompts, `AI_STUB` fixtures, and `fullstackweb`'s fallback `seoTitle` slicer.
  - Update `scripts/blog-aeo-selfcheck.mjs` and `scripts/hendranicholas-blog-selfcheck.mjs` to test the per-site `seoTitle` bounds.
  - Update `inasoft-site/.claude/skills/write-blog-article/scripts/check_post.mjs` (`max 50`), `railsdev-site/.claude/skills/write-blog-article/scripts/check_post.mjs` (`max 49`), and `fullstackwebdev-site/scripts/check-post.mjs` (`max 39`).
- **Non-Goals**:
  - Changing `src/content.config.ts` (`z.string().max(60)` remains a safe upper bound) or `[slug].astro` brand suffixes.
  - Changing `inasoft-site/scripts/seo-audit.mjs` (`<= 60` rendered `<title>` check remains strict).

## Approaches
1. **Per-site `seoTitle` budget `60 - suffix.length` in writers + site `check_post` scripts (Chosen)**: Keeps rendered `<title>` at 50–60 chars across all four sites without touching layouts or `seo-audit.mjs`.
2. **Raise `seo-audit.mjs` `<title>` cap to 70**: Rejected; allows SERP title truncation.
