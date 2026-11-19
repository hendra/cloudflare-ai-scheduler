# Blog writer reliability — design (short)

## Why
Since the AEO/GEO gate landed (2026-11-18) the three blog writers fail most runs. Logs of 12 failed
runs show two causes: (1) the body model (`groq openai/gpt-oss-120b`) writes 900–1440 words against a
1500-word gate and a short draft is thrown away and rewritten from scratch; (2) every model tested
forgets some required links (`/services/…` or `/layanan/…`, the contact CTA, an external source) or
leaves a code fence untagged, and a feedback retry fixes one and breaks another. The grounding repair
can also drop the only external link.

## Measured (2026-11-19, same prompt + validator, `/tmp/opencode/model-bench.mjs`)
| Model | Words | Missing |
|---|---|---|
| groq `openai/gpt-oss-120b` | 1284 / 1392 | length, service link, internal links, verification note |
| groq `qwen/qwen3.8-27b` | 2095 / 2290 (6 s) | external source only; OTPM 1000 → frequent 429 |
| gemini `gemma-4-31b-it` | 2641 / 2701 (131–197 s) | contact link, external source |
| cloudflare / kilo / nemotron | 909–1607 | length, links |
| gemini `3.5/3.8-flash` | — | 503 / quota 429 / >240 s |

## Approaches
- **A (picked by owner):** code inserts the links it already knows + better body models + expand a
  short draft instead of discarding it.
- B: stricter prompts and more retries — rejected, models ignore it and each retry costs minutes of 429s.
- C: relax the validator — rejected, lowers SEO quality.

## Design
1. `ensureRequiredLinks(body, cfg)` in `scripts/blog-aeo.mjs`, applied to every body before validation
   (first draft, feedback retry, grounding repair). It only adds what is missing:
   service link, contact link (label = site's required text, e.g. "Konsultasi Gratis"), a primary-source
   link to the chosen signal page (only when that page was fetched OK, so grounding can read it),
   `text` tag on untagged opening fences, and rewrites absolute self-domain links to relative ones.
   Added sentences go at the end of the `## Conclusion` / `## Kesimpulan` section, in the site language.
2. `generateBody({ callModel, prompt, minWords })` in `scripts/blog-aeo.mjs`: up to 3 calls; a short
   draft is sent back with "expand to ≥ minWords, keep every section" instead of being discarded.
   Used for the first draft and the feedback retry in all three writers.
3. `callModel(..., { prefer })` in `scripts/ai-providers.mjs`: preferred `{provider, model, timeoutMs}`
   entries tried before the normal chain. `LONGFORM_MODELS` = groq `qwen/qwen3.8-27b`, then gemini
   `gemma-4-31b-it` with a 240 s timeout. Body calls only; topic/metadata/cover/grounding keep the chain.
4. Blog workflows drop `opencode` from the chain (always 429 in CI) and raise `timeout-minutes` 30 → 45
   (gemma takes up to ~200 s per call).
5. **Owner decision:** still under 1500 words after expansion → Slack note, nothing published,
   `exit 0` (like the grounding skip). Other validation failures still fail red.

## Non-goals
Lowering the 1500 gate; changing validator rules; touching other pipelines.

## Left to the builder
Exact wording of inserted sentences; where the length-skip check sits in each writer.
