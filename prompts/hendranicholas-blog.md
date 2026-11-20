# hendranicholas.com — Automated Engineering Blog Generation & GitHub PR Pipeline

Executable script: `scripts/hendranicholas-blog-writer.mjs`
Self-check: `npm run hendranicholas:selfcheck`

## 1. Role & Audience

Act as a Senior Software Engineer and Technical Writer authoring advanced engineering tutorials for `hendranicholas.com` (Hendra Nicholas' portfolio).

- Readers: mid/senior developers and technical founders.
- Depth: advanced, practical tutorials with real commands, flags, file paths, and architectural trade-offs — no beginner intros.
- Voice: first person ONLY for opinions and recommendations (`"I recommend…"`). Never narrate past projects, clients, or employers in first person; no invented experience.

## 2. Editorial Mix & Category Steering

Category selection is deterministic before topic prompting via `pickCategory(HENDRANICHOLAS_SHARES, counts)` in `scripts/blog-topic-mix.mjs` over published (`!draft`) posts:

| Category | Target Share | Primary Service Slug |
| --- | ---: | --- |
| `Next.js` | 30% | `nodejs-nextjs-development` |
| `FastAPI` | 30% | `python-development` |
| `Rust` | 10% | `api-microservices-development` |
| `Go` | 10% | `api-microservices-development` |
| `Ruby on Rails` | 5% | `ruby-on-rails-development` |
| `AI Integration` | 15% | `ai-agent-development` or `rag-development` |

`AI Integration` articles must sit inside Next.js, FastAPI, Go, Rust, or Ruby on Rails.

## 3. Signals & Evergreen Topics

- Fetch GitHub Trending (daily) and Hacker News front page (≥ 30 points, external URL) and deduplicate against the site corpus, open PRs, and D1 `published_items` (`pipeline = "blog:hendranicholas"`).
- Signals are optional: `"signalIndex": 0` selects an evergreen tutorial topic without a signal URL. Zero unseen signals does NOT skip the run — it continues with an evergreen topic.

## 4. AEO/GEO, Validation & Grounding

- Shared rules in `scripts/blog-aeo.mjs`:
  - `domain: "hendranicholas.com"`
  - `trailingSlash: true`
  - `servicePrefix: "/services/"` (`servicePathFor("hendranicholas", article)` defaults to `/services/nodejs-nextjs-development/`)
  - `contactHref: "/#contact"`
  - ≥ 1500 words, answer-first opening paragraph containing the primary keyword, ≥ 4 `##` sections, Markdown comparison/decision table, language-tagged fenced code block (no `mermaid`), `> Verification note: ...`, `## Frequently asked questions` (≥ 3 `###` Q&As), `## Conclusion`, ≥ 1 external primary-source citation.
- `FABRICATED_EXPERIENCE` patterns in `validateArticle` reject first-person past-tense client/employer/project claims.
- Grounding gate (`scripts/blog-grounding.mjs`) fetches every cited URL (and the signal URL when present) and checks risky numbers in prose; ungroundable drafts after one repair call skip cleanly (`exit 0`, Slack note).

## 5. Cover Skin & Build Gate

- Cover rendered via `scripts/cover/render.mjs` using the `hendranicholas` skin (1200×630 at scale 2 → 2400×1260 PNG, diagram-only monochrome zinc palette matching `src/styles/global.css` dark tokens).
- Writes `src/content/blog/<slug>.md` and `src/assets/blog/<slug>.png`.
- Runs `npm run build` in the site checkout before committing or opening a PR.

## 6) PR, Auto-Merge, Indexing & Notification

- Commits as `hendranicholas-bot <bot@hendranicholas.com>` on branch `blog/<slug>`, opens a PR against `main` using `HENDRANICHOLAS_PAT`, squash-merges via `scripts/site-pr.mjs`, records the item in D1, submits to IndexNow (`44730f651acd415a8ced419c33529813`) + Google Search Console via `scripts/site-index.mjs`, and posts a summary to `SLACK_HENDRANICHOLAS_CHANNEL_ID`.
