#!/usr/bin/env node
import { callModel, LONGFORM_MODELS } from "./ai-providers.mjs";
import { generateCover } from "./cover/render.mjs";
import { mergePr } from "./site-pr.mjs";
import { indexArticle, sitemapLocs } from "./site-index.mjs";
import { groundArticle } from "./blog-grounding.mjs";
import { fetchSourceText } from "./grounding.mjs";
import { pickCategory, HENDRANICHOLAS_SHARES } from "./blog-topic-mix.mjs";
import {
  buildAeoGeoBodyRules,
  validateAeoGeo,
  ensureRequiredLinks,
  generateBody,
  servicePathFor,
  runSitePostCheck,
  isMetaErr,
} from "./blog-aeo.mjs";
import {
  fetchPublished,
  recordPublished,
  filterUnseenCandidates,
  loadOpenPrs,
  checkTopicCollision,
  loadBlogCorpus,
  buildBlogHistory,
  buildBlogAvoidList,
} from "./published.mjs";
// hendranicholas.com blog writer (PR + auto-merge) — deterministic, zero dependencies.
//
// Flow: pick target category from HENDRANICHOLAS_SHARES → fetch signals (optional;
//   evergreen fallback allowed) → load existing corpus → 1 AI completion picks a topic
//   in the target category → 1 AI completion writes the markdown body (hard-validated) →
//   grounding gate → cover rendered by headless Chrome (scripts/cover/) → write .md + cover →
//   `npm run build` must pass → branch → commit → push → PR → auto-merge → index → Slack.
//
// Env:
//   SITE_DIR        path to the hendranicholas-site checkout (default: "hendranicholas-site")
//   DRY_RUN=true    everything except git push / PR / Slack (build still runs)
//   AI_STUB=true    deterministic fake article (offline testing; never pushed)
//   AI_PROVIDER / AI_FALLBACKS / AI_MODEL / <PROVIDER>_MODEL  (same as digests)
//   HENDRANICHOLAS_PAT PAT with Contents RW + PR write on hendranicholas-site
//   SLACK_BOT_TOKEN, SLACK_HENDRANICHOLAS_CHANNEL_ID   (for the final summary note)
//   PUBLIC_FORMSPREE_ID  (read from site .env or env at build time)
// Exit: 0 ok (PR opened, skipped cleanly, or dry-run printed), 1 failure (Slack note attempted).

import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PIPELINE = "blog:hendranicholas";

const DRY_RUN = String(process.env.DRY_RUN || "false") === "true";
const AI_STUB = process.env.AI_STUB === "true";
const SITE_DIR = process.env.SITE_DIR || "hendranicholas-site";
const SITE_URL = "https://hendranicholas.com";
const INDEXNOW_KEY = "44730f651acd415a8ced419c33529813";
const HENDRANICHOLAS_PAT = process.env.HENDRANICHOLAS_PAT || "";
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const SLACK_CHANNEL = process.env.SLACK_HENDRANICHOLAS_CHANNEL_ID || "";

// Mirrors src/data/services/ (excluding index.ts) in hendranicholas-site.
export const SERVICE_VALUES = [
  "nodejs-nextjs-development",
  "python-development",
  "api-microservices-development",
  "ruby-on-rails-development",
  "ai-agent-development",
  "rag-development",
  "react-development",
  "saas-development",
  "rails-modernization",
];

// Mirrors BLOG_CATEGORIES in hendranicholas-site src/lib/blog-topics.ts.
export const CATEGORY_VALUES = [
  "Next.js",
  "FastAPI",
  "Rust",
  "Go",
  "Ruby on Rails",
  "AI Integration",
];

const CATEGORY_ALIASES = {
  "nextjs": "Next.js",
  "next.js": "Next.js",
  "python": "FastAPI",
  "python and fastapi": "FastAPI",
  "golang": "Go",
  "rails": "Ruby on Rails",
  "ai": "AI Integration",
  "ai/llm": "AI Integration",
  "ai engineering": "AI Integration",
};

export const FABRICATED_EXPERIENCE = [
  [/\bwhen I (built|migrated|shipped|deployed|worked)\b/i, "fabricated experience: first-person past-tense project story"],
  [/\b(for|with) (a|one of my|my) clients?\b/i, "fabricated experience: invented client story"],
  [/\bat my (previous|last|former)\b/i, "fabricated experience: invented employer story"],
  [/\bI (migrated|rebuilt|shipped|deployed|scaled) (a|our|the|my)\b/i, "fabricated experience: first-person past-tense action"],
  [/\bin production at\b/i, "fabricated experience: unverifiable production claim"],
];

const strip = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const countBy = (items, key) => items.reduce((acc, item) => (item?.[key] ? ((acc[item[key]] = (acc[item[key]] || 0) + 1), acc) : acc), {});

// ---------- tiny helpers ----------
async function fetchText(url, { timeout = 25000, headers = {}, ua = "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0" } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { "User-Agent": ua, ...headers }, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return { text: await res.text(), url: res.url };
  } finally { clearTimeout(t); }
}

async function fail(msg) {
  console.error("FATAL:", msg);
  try {
    const posted = await postToSlack([`⚠️ _hendranicholas.com blog writer failed:_ ${msg}`.slice(0, 500)]);
    if (posted) { try { writeFileSync("failure-posted", "1"); } catch {} }
  } catch {}
  process.exit(1);
}

async function postToSlack(messages) {
  if (DRY_RUN || !SLACK_BOT_TOKEN || !SLACK_CHANNEL) { messages.forEach((m) => console.log("[dry] slack:", m.slice(0, 120))); return false; }
  for (const text of messages) {
    const res = await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ channel: SLACK_CHANNEL, text }) });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) throw new Error(`Slack post failed: ${body.error || res.status}`);
  }
  console.log(`Slack post: ok (${messages.length})`);
  return true;
}

// ---------- AI ----------
function parseJSONObject(raw) { const m = String(raw).match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } }

// ---------- signals ----------
function parseTrending(html) {
  const blocks = html.match(/<article class="Box-row">[\s\S]*?<\/article>/g) || [];
  return blocks.slice(0, 15).map((b) => {
    const href = (b.match(/<h2[^>]*>[\s\S]*?href="(\/[^"]+)"/) || [])[1] || "";
    const desc = strip((b.match(/<p class="col-9[^>]*>([\s\S]*?)<\/p>/) || [])[1] || "");
    const starsToday = (b.match(/([\d,]+)\s*stars? today/) || [])[1] || "";
    return { source: "github-trending", title: href.slice(1), url: `https://github.com${href}`, description: desc, signals: `${starsToday} stars today` };
  }).filter((x) => x.title.includes("/"));
}

// ---------- corpus ----------
const loadCorpus = loadBlogCorpus;

// ---------- AI-stub article (offline testing only) ----------
export function stubArticle() {
  const body = `FastAPI dependency injection composes database sessions, authentication guards, and request-scoped configuration through explicit callable graphs without mutating global module state. ${"Stubbed lead context on typed Python request lifecycles and cleanup guarantees. ".repeat(4)}

## Why explicit dependencies beat router-level globals

Explicitly declared dependencies isolate side effects per request, make unit overrides trivial with \`app.dependency_overrides\`, and prevent leaked database transactions when exceptions unwind. For official behavior, see the [FastAPI dependency docs](https://fastapi.tiangolo.com/tutorial/dependencies/) and the [Python development service](/services/python-development/). ${"Stubbed section on request lifecycle isolation and testing boundaries. ".repeat(90)}

| Pattern | Scope | Cleanup behavior |
| --- | --- | --- |
| \`yield\` dependency | Per request or sub-dependency | Runs \`finally\` block after response |
| Cached \`Depends\` | Per request by default | Deduplicated within one request graph |
| Lifespan state | Application process | Closed cleanly on ASGI shutdown |

## How do you compose Pydantic v2 validation with dependencies?

\`\`\`python
from typing import Annotated
from fastapi import Depends, FastAPI
from pydantic import BaseModel, Field

app = FastAPI()

class Pagination(BaseModel):
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0)

def pagination_params(limit: int = 20, offset: int = 0) -> Pagination:
    return Pagination(limit=limit, offset=offset)

@app.get("/items")
def list_items(page: Annotated[Pagination, Depends(pagination_params)]):
    return {"limit": page.limit, "offset": page.offset}
\`\`\`

${"Pydantic v2 schema validation and annotated dependency boundaries explained step by step. ".repeat(90)}

## Common pitfalls with nested yield dependencies

${"Patterns to avoid when sharing connections, opening async generators, and overriding dependencies in tests. ".repeat(90)}

## Verification

> Verification note: stubbed content for pipeline testing only. Not for publication.

## Frequently asked questions

### Does FastAPI cache dependency results within a single request?

Yes — by default \`use_cache=True\` reuses the resolved return value when multiple dependencies in the same request depend on the same callable.

### When should a dependency use yield instead of return?

Use \`yield\` whenever the dependency acquires a resource such as a database session or HTTP client that must be closed after the endpoint finishes.

### Can Pydantic v2 models validate query and header groups?

Yes, wrapping shared parameters in a dependency function that instantiates a Pydantic v2 \`BaseModel\` keeps validation rules reusable across routes.

## Conclusion

Keep dependency functions small, scope stateful resources with \`yield\`, and validate boundaries with Pydantic v2 models. If you want architecture help on a Python API, [get in touch](/#contact). ${"Wrap-up and next steps for structuring maintainable FastAPI services. ".repeat(65)}`;
  return {
    title: "Structuring FastAPI Dependency Injection and Pydantic v2 Validation",
    seoTitle: "Structuring FastAPI Dependency Injection & Pydantic v2",
    description: "Practical guide to structuring fastapi dependency injection and Pydantic v2 validation in Python APIs without tangled router state.",
    keyword: "fastapi dependency injection",
    slug: "fastapi-dependency-injection-pydantic-v2-guide",
    category: "FastAPI",
    services: ["python-development"],
    coverAlt: "Diagram of a FastAPI request pipeline passing through dependency injection and Pydantic v2 validation",
    body,
  };
}

// ---------- metadata helpers ----------
const MIN_BODY_WORDS = 1500;
const META_KEYS = ["title", "seoTitle", "description", "keyword", "slug", "category"];

export function normalizeCategory(raw, { title = "", keyword = "", services = [] } = {}) {
  const clean = String(raw || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const lower = clean.toLowerCase();
  const exact = CATEGORY_VALUES.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;
  if (CATEGORY_ALIASES[lower]) return CATEGORY_ALIASES[lower];

  const guess = `${clean} ${title || ""} ${keyword || ""} ${Array.isArray(services) ? services.join(" ") : ""}`;
  if (/\b(next\.?js|nextjs|app router|server actions)\b/i.test(guess)) return "Next.js";
  if (/\b(fastapi|pydantic|uvicorn|python)\b/i.test(guess)) return "FastAPI";
  if (/\brust\b/i.test(guess)) return "Rust";
  if (/\b(?:golang|goroutine)\b|\bGo\b/.test(guess)) return "Go";
  if (/\b(rails|ruby on rails|activerecord|hotwire)\b/i.test(guess)) return "Ruby on Rails";
  if (/\b(ai|llm|rag|agent|tool calling|embedding|claude|gemini|openai)\b/i.test(guess)) return "AI Integration";
  return "Next.js";
}

function normalizeServices(a) {
  const filtered = Array.isArray(a.services)
    ? a.services.filter((x) => SERVICE_VALUES.includes(x))
    : [];
  if (filtered.length > 0) return filtered;
  const cat = normalizeCategory(a.category, a);
  const guess = `${a.keyword || ""} ${a.title || ""}`;
  let fallback;
  if (cat === "Next.js") fallback = ["nodejs-nextjs-development"];
  else if (cat === "FastAPI") fallback = ["python-development"];
  else if (cat === "Rust" || cat === "Go") fallback = ["api-microservices-development"];
  else if (cat === "Ruby on Rails") fallback = ["ruby-on-rails-development"];
  else if (cat === "AI Integration") {
    fallback = /\b(rag|retriev|vector|embedding|pgvector)\b/i.test(guess)
      ? ["rag-development"]
      : ["ai-agent-development"];
  } else {
    fallback = ["nodejs-nextjs-development"];
  }
  console.warn("services: fallbacks applied ->", fallback);
  return fallback;
}

// ---------- validation ----------
export function validateArticle(a, corpusSlugs, extraCfg = {}) {
  const prevCategory = a.category;
  a.category = normalizeCategory(a.category, a);
  if (a.category !== prevCategory) console.warn(`category: normalized ${JSON.stringify(prevCategory)} -> ${JSON.stringify(a.category)}`);
  a.services = normalizeServices(a);
  return validateAeoGeo(a, {
    lang: "en",
    domain: "hendranicholas.com",
    minWords: MIN_BODY_WORDS,
    trailingSlash: true,
    servicePrefix: "/services/",
    contactHref: "/#contact",
    conclusionHeading: "Conclusion",
    faqHeading: "Frequently asked questions",
    existingSlugs: corpusSlugs,
    indonesianGuard: true,
    bannedPatterns: [
      ...FABRICATED_EXPERIENCE,
      [/number one|no\. ?1\b|#1\b|world-class|best-in-class/i, "unverifiable superlative"],
      [/\b(our team|our developers|our engineers)\b/i, 'hendranicholas.com is one developer: write "I"'],
      [/\$ ?\d[\d,.]*\s*(\/ ?h(ou)?r|per hour|an hour)/i, "rates are never published"],
    ],
    ...extraCfg,
  });
}

// ---------- frontmatter ----------
function frontmatter(a) {
  const svcLines = Array.isArray(a.services) && a.services.length > 0 ? `services: [${a.services.map((x) => `"${x}"`).join(", ")}]\n` : "";
  const d = new Date();
  const pub = new Date(d.getTime() + 7 * 3600_000).toISOString().replace(/\.\d+Z$/, "+07:00");
  const svcLine = svcLines.trim() ? svcLines : "";
  const cat = a.category ? `category: ${JSON.stringify(a.category)}\n` : "";
  const kwLine = a.keyword ? `keyword: ${JSON.stringify(a.keyword)}\n` : "";
  return `---\ntitle: ${JSON.stringify(a.title)}\nseoTitle: ${JSON.stringify(a.seoTitle)}\ndescription: ${JSON.stringify(a.description)}\n${kwLine}${cat}pubDate: ${pub}\n${svcLine}cover: "../../assets/blog/${a.slug}.png"\ncoverAlt: ${JSON.stringify(a.coverAlt)}\ndraft: false\n---\n\n${a.body.trim()}\n`;
}

// ---------- main ----------
async function main() {
  if (!existsSync(join(SITE_DIR, "package.json"))) await fail(`site checkout not found at ${SITE_DIR} (set SITE_DIR)`);
  const corpus = loadCorpus(SITE_DIR);
  let publishedRows;
  try {
    publishedRows = await fetchPublished({ pipeline: PIPELINE, limit: 500, dryRun: DRY_RUN });
  } catch (e) {
    await fail(`published ledger fetch failed: ${String(e?.message || e).slice(0, 220)}`);
    return;
  }
  let openPrs;
  try {
    openPrs = loadOpenPrs({ siteDir: SITE_DIR, pat: HENDRANICHOLAS_PAT, dryRun: DRY_RUN });
  } catch (e) {
    await fail(`open PR lookup failed: ${String(e?.message || e).slice(0, 220)}`);
    return;
  }
  const history = buildBlogHistory({ corpus, openPrs, publishedRows });
  const corpusSlugs = [...history.slugs];
  console.log(`corpus: ${corpus.length} posts | open PRs: ${openPrs.slugs.size} | D1 ledger: ${publishedRows.length} | total known slugs: ${corpusSlugs.length}`);

  // 1) signals (optional: zero unseen signals continues with an evergreen topic)
  const rawSignals = [];
  try { rawSignals.push(...parseTrending((await fetchText("https://github.com/trending?since=daily")).text)); console.log(`trending: ${rawSignals.length}`); } catch (e) { console.error("trending fetch failed:", e.message); }
  try {
    const hn = JSON.parse((await fetchText("https://hn.algolia.com/api/v1/search_by_date?tags=front_page&hitsPerPage=30")).text);
    const hnStories = (hn.hits || []).filter((h) => (h.points || 0) >= 30 && h.url).map((h) => ({ source: "hacker-news", title: h.title, url: h.url, description: h.title, signals: `${h.points} points, ${h.num_comments} comments` }));
    rawSignals.push(...hnStories);
    console.log(`hn front page: ${hnStories.length}`);
  } catch (e) { console.error("hn fetch failed:", e.message); }

  const signals = filterUnseenCandidates(rawSignals, { urls: history.urls, titles: history.titles }, {
    getUrl: (s) => s.url,
    getTitle: (s) => s.title,
  });
  console.log(`unseen signals: ${signals.length}/${rawSignals.length} (filtered ${rawSignals.length - signals.length})`);

  // 2) topic selection (category steered by HENDRANICHOLAS_SHARES)
  const target = pickCategory(HENDRANICHOLAS_SHARES, countBy(corpus.filter((c) => !c.draft), "category"));
  console.log(`target category: ${target}`);

  const avoidPosts = buildBlogAvoidList({ corpus, openPrs, publishedRows, max: 150 });
  const existingKeywords = [...new Set([...corpus.map((c) => c.keyword).filter(Boolean), ...history.keywords])];
  const validBlogPaths = new Set(corpus.filter((c) => !c.draft).map((c) => `/blog/${c.slug}/`));
  const signalListText = signals.length > 0
    ? signals.map((s, i) => `${i + 1}. [${s.source}] ${s.title} — ${s.description.slice(0, 160)} (${s.signals})`).join("\n")
    : "(none — pick an evergreen tutorial topic and set signalIndex to 0)";
  const topicPrompt = `You pick ONE blog topic for Hendra Nicholas' portfolio (hendranicholas.com). Readers are mid/senior developers and technical founders. Write advanced, practical engineering tutorials ONLY — no beginner intros.
Category MUST be "${target}".${target === "AI Integration" ? ' ("AI Integration" articles MUST sit inside Next.js, FastAPI, Go, Rust, or Ruby on Rails.)' : ""}
Signals are optional: pick a matching signal from Signals below, OR set "signalIndex": 0 for an evergreen tutorial topic (no signal source URL).
Reply with ONLY this JSON (no prose): {"signalIndex":<0..${signals.length}>,"topic":"short topic","keyword":"primary keyword","angle":"one-line angle","rationale":"why this wins","title":"article H1, 20-120 chars","seoTitle":"50-60 chars","description":"120-160 chars","slug":"kebab-case-slug","category":${JSON.stringify(target)},"services":${JSON.stringify(SERVICE_VALUES)}}
Avoid all of these existing posts: ${avoidPosts.join(" | ")}
Avoid these existing target keywords: ${existingKeywords.slice(0, 100).join(", ")}
Signals:
${signalListText}`;

  const stub = AI_STUB ? stubArticle() : null;
  let topic = stub ? {
    signalIndex: 0,
    topic: "FastAPI dependency injection and Pydantic v2 validation",
    keyword: stub.keyword,
    angle: "practical guide",
    rationale: "stub",
    title: stub.title,
    seoTitle: stub.seoTitle,
    description: stub.description,
    slug: stub.slug,
    category: stub.category,
    services: stub.services,
    coverAlt: stub.coverAlt,
  } : null;
  let chosenSignal = null;
  if (!topic) {
    let feedback = "";
    let collisions = 0;
    const collisionReasons = [];
    let lastWasCollision = false;
    for (let attempt = 1; attempt <= 3 && !topic; attempt++) {
      try {
        const candidate = parseJSONObject(await callModel(topicPrompt + feedback, { maxTokens: 4096 }));
        if (!candidate || typeof candidate !== "object") {
          lastWasCollision = false;
          console.error(`topic attempt ${attempt}: invalid JSON`);
          const prior = collisionReasons.length ? ` Previously rejected: ${collisionReasons.join("; ")}.` : "";
          feedback = `\n\nPrevious reply invalid; reply with ONLY the JSON object.${prior}`;
          continue;
        }
        const candCat = CATEGORY_VALUES.find((c) => c.toLowerCase() === String(candidate.category || "").trim().toLowerCase());
        if (candCat !== target) {
          lastWasCollision = false;
          console.error(`topic attempt ${attempt}: wrong category "${candidate.category}" (need "${target}")`);
          feedback = `\n\nPrevious reply had category ${JSON.stringify(candidate.category)}; category MUST be ${JSON.stringify(target)}.`;
          continue;
        }
        candidate.category = target;
        const sigIdx = Number.parseInt(candidate.signalIndex, 10);
        if (!Number.isInteger(sigIdx) || sigIdx < 0 || sigIdx > signals.length) {
          lastWasCollision = false;
          console.error(`topic attempt ${attempt}: invalid signalIndex ${candidate.signalIndex}`);
          feedback = `\n\nPrevious reply had invalid signalIndex; use 0 for evergreen or 1..${signals.length} from Signals.`;
          continue;
        }
        const sig = sigIdx === 0 ? null : signals[sigIdx - 1];
        const collision = checkTopicCollision(
          { slug: candidate.slug, title: candidate.title, topic: candidate.topic, keyword: candidate.keyword, signalUrl: sig?.url || "" },
          history,
        );
        if (collision) {
          collisions++;
          lastWasCollision = true;
          const label = candidate.slug || candidate.title || candidate.topic || `signal #${candidate.signalIndex ?? "?"}`;
          collisionReasons.push(`${label} (${collision})`);
          console.log(`topic attempt ${attempt} rejected (${collision})`);
          feedback = `\n\nPrevious topic(s) rejected (${collisionReasons.join("; ")}); pick a DIFFERENT topic or evergreen angle.`;
          continue;
        }
        lastWasCollision = false;
        topic = candidate;
        chosenSignal = sig;
      } catch (e) {
        lastWasCollision = false;
        console.error(`topic attempt ${attempt}:`, e.message);
        const prior = collisionReasons.length ? ` Previously rejected: ${collisionReasons.join("; ")}.` : "";
        feedback = `\n\nPrevious reply invalid; reply with ONLY the JSON object.${prior}`;
      }
    }
    if (!topic) {
      if (collisions > 0 && lastWasCollision) {
        console.log(`skipping: all topic attempts collided with existing content (${collisions} collision(s))`);
        process.exit(0);
      }
      await fail("topic selection failed after 3 attempts");
    }
  }
  const meta = topic;
  console.log(`topic: ${topic.topic} | keyword: ${topic.keyword} | angle: ${topic.angle} | category: ${meta.category}`);
  console.log(`meta: ${meta.title} | ${meta.slug}`);

  // 3) article body (metadata already produced in the topic call)
  meta.category = normalizeCategory(meta.category, meta);
  meta.services = normalizeServices(meta);
  const existingLinks = corpus.filter((c) => !c.draft).slice(0, 40).map((c) => `/blog/${c.slug}/ — ${c.title}`);
  const signalSource = AI_STUB || !chosenSignal?.url ? "" : (await fetchSourceText(chosenSignal.url)).text;
  const signalText = signalSource.slice(0, 6000);
  if (signalText) console.log(`signal source: ${signalText.length} chars from ${chosenSignal.url}`);
  const sourceBlock = signalText
    ? `\n\nSource material (facts you may state — never state a fact that is not here or in an official doc you can cite):\n${signalText}`
    : "";
  const makeBodyPrompt = (a) => {
    const aeoRules = buildAeoGeoBodyRules({
      siteName: "Hendra Nicholas",
      lang: "en",
      domain: "hendranicholas.com",
      voiceRule: 'first person only for opinions and recommendations ("I recommend…"); never narrate past projects, clients or employers in first person; no invented experience',
      keyword: a.keyword,
      serviceHref: servicePathFor("hendranicholas", a),
      contactHref: "/#contact",
      ctaInstruction: "End Conclusion with a natural CTA linking to [get in touch](/#contact).",
      validPostLinks: existingLinks,
      extraRules: [
        "All internal links MUST include a trailing slash (e.g. /services/.../, /blog/.../), except /#contact.",
        "Be concrete: real file paths, real flags, real package names. Generic AI/placeholder advice is not acceptable.",
        "Never publish unverifiable superlatives (number one, #1, world-class, best-in-class) or hourly/project rates.",
        "Never invent client work, past employers, or first-person past-tense migration/deployment stories.",
      ],
    });
    return `Write the body of one hendranicholas.com blog article.
Topic: ${a.topic}. Keyword: "${a.keyword}". Angle: ${a.angle}. Title: ${a.title}.
${aeoRules}
Return ONLY the article body as markdown: the opening paragraph and "##" sections. No title, no frontmatter, no preamble, no trailing notes.${sourceBlock}`;
  };
  const bodyModel = (p) => callModel(p, { maxTokens: 8000, expectJSON: false, prefer: LONGFORM_MODELS });
  const withLinks = (a, text) => ensureRequiredLinks(text, {
    domain: "hendranicholas.com",
    lang: "en",
    serviceHref: servicePathFor("hendranicholas", a),
    contactHref: "/#contact",
    contactLabel: undefined,
    sourceUrl: signalSource ? chosenSignal.url : null,
    conclusionHeading: "Conclusion",
  });
  const skipShort = async (words) => {
    const note = `⚠️ _hendranicholas.com article skipped — too short:_ *${meta.title}*\nThe body stayed at ${words} words after expansion (need ${MIN_BODY_WORDS}). Nothing was published.`;
    try { await postToSlack([note]); } catch (e) { console.error("skip note failed:", e.message); }
    console.log(`skipping: ${note}`);
    process.exit(0);
  };
  let draft;
  try {
    draft = stub ? { body: stub.body } : await generateBody({ callModel: bodyModel, prompt: makeBodyPrompt(meta), minWords: MIN_BODY_WORDS });
  } catch (e) { await fail(`article body generation failed: ${String(e?.message || e).slice(0, 300)}`); return; }
  if (!draft.body) await skipShort(draft.words);
  const body = withLinks(meta, draft.body);
  const article = { ...meta, body };
  console.log(`article: ${article.title} | ${article.slug} | seoTitle ${String(article.seoTitle || "").length}c`);

  // 4) validation (with one self-correction retry)
  const runValidate = (a) => validateArticle(a, corpusSlugs, { existingKeywords, validBlogPaths });
  let v = runValidate(article);
  // 4a) metadata self-correction
  if (!v.ok && v.errs.some(isMetaErr)) {
    console.error("metadata validation failed, requesting metadata fix:", v.errs.join("; "));
    try {
      const metaNow = Object.fromEntries(META_KEYS.map((k) => [k, article[k]]));
      const fixPrompt = `You previously produced this blog metadata JSON for hendranicholas.com:\n${JSON.stringify(metaNow)}\nIt failed validation: ${v.errs.filter(isMetaErr).join("; ")}.\nReturn ONLY a corrected JSON object with exactly the same keys. Hard constraints:\n- title: 20-120 chars\n- seoTitle: 50-60 chars\n- description: 120-160 chars and MUST contain "${article.keyword}"\n- keyword: keep "${article.keyword}" unless it cannot fit; primary keyword only; NOT any existing target keyword\n- slug: kebab-case (a-z0-9 and hyphens), NOT any of: ${corpusSlugs.slice(0, 60).join(", ")}\n- category: must stay ${JSON.stringify(target)}\nOutput ONLY the JSON object, no prose.`;
      const fixed = parseJSONObject(await callModel(fixPrompt, { maxTokens: 2048 }));
      if (fixed && typeof fixed === "object") {
        for (const k of META_KEYS) if (k !== "category" && typeof fixed[k] === "string" && fixed[k].trim()) article[k] = fixed[k].trim();
        v = runValidate(article);
        console.log(v.ok ? "validation ok after metadata fix" : `still failing after metadata fix: ${v.errs.join("; ")}`);
      }
    } catch (e) { console.error("metadata fix call failed:", e.message); }
  }
  if (!v.ok) {
    console.error("validation failed, retrying body with feedback:", v.errs.join("; "));
    let retryShortWords = null;
    const retryBody = await (async () => {
      let last = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const prompt = makeBodyPrompt(article) + `\n\nYour previous draft failed validation: ${v.errs.join("; ")}. Return a corrected markdown body that fixes these issues while still meeting EVERY requirement above (length, H2 sections, table, FAQ, code example, verification note blockquote). Return ONLY the body.`;
        let r;
        try { r = await generateBody({ callModel: bodyModel, prompt, minWords: MIN_BODY_WORDS, attempts: 2 }); } catch (e) { console.error(`retry body attempt ${attempt}:`, e.message); continue; }
        if (!r.body) { console.error(`retry body attempt ${attempt}: too short (${r.words} words)`); retryShortWords = r.words; continue; }
        last = withLinks(article, r.body);
        v = runValidate({ ...article, body: last });
        if (v.ok) return last;
        if (v.errs.every(isMetaErr)) { console.error("retry body: only metadata errors remain; a body rewrite cannot fix them"); break; }
        console.error(`retry body attempt ${attempt} still failing: ${v.errs.join("; ")}`);
      }
      return last;
    })();
    if (retryBody) {
      article.body = retryBody;
      v = runValidate(article);
      if (v.ok) { console.log(`validation ok after retry — ${v.wordCount} words, ${v.links.length} links`); } else { await fail(`article validation failed after retry: ${v.errs.join("; ")}`); return; }
    } else { await fail(`article validation failed: ${v.errs.join("; ")}${retryShortWords !== null ? ` (retry drafts too short: ${retryShortWords} words)` : ""}`); return; }
  } else {
    console.log(`validation ok — ${v.wordCount} words, ${v.links.length} external links to check`);
  }

  // 4b) grounding gate
  let groundedLinks = v.links.length;
  if (!AI_STUB) {
    const g = await groundArticle({ article, links: v.links, signalUrl: chosenSignal?.url || null, signalText: signalSource, callModel: (p) => callModel(p, { maxTokens: 8000, expectJSON: false }) });
    if (!g.ok) {
      const note = `⚠️ _hendranicholas.com article skipped — unverifiable facts:_ *${article.title}*\nNumbers not found in any cited source: ${g.unverified.join(", ") || "(none)"}\nCitations that could not be fetched (404 / network): ${g.deadSources.join(", ") || "(none)"}\nUnreadable citations: ${g.unreadable.join(", ") || "(none)"}\nNothing was published.`;
      try { await postToSlack([note]); } catch (e) { console.error("skip note failed:", e.message); }
      console.log(`skipping: ${note}`);
      process.exit(0);
    }
    if (g.body !== article.body) {
      article.body = withLinks(article, g.body);
      v = runValidate(article);
      if (!v.ok) { await fail(`article validation failed after grounding repair: ${v.errs.join("; ")}`); return; }
      groundedLinks = v.links.length;
    }
    console.log(`grounding ok — ${g.sources.length} source(s) read`);
    if (g.unreadable.length) console.log(`::warning title=Unreadable citations::${g.unreadable.join(" | ")}`);
  }

  // 5) cover
  const coverPath = join(SITE_DIR, "src/assets/blog", `${article.slug}.png`);
  try { article.coverAlt = await generateCover({ site: "hendranicholas", article, siteDir: SITE_DIR, outPath: coverPath, callModel, stub: AI_STUB }); console.log("cover generated:", coverPath); } catch (e) { await fail(e.message); return; }

  // 6) write .md
  const mdPath = join(SITE_DIR, "src/content/blog", `${article.slug}.md`);
  writeFileSync(mdPath, frontmatter(article));
  console.log("wrote", mdPath);

  // 7) post lint + build + blog verification must pass
  const relMdPath = join("src/content/blog", `${article.slug}.md`);
  console.log("running site post check …");
  try {
    const chk = runSitePostCheck({ siteDir: SITE_DIR, relMdPath });
    if (chk.skipped) console.log("site post check skipped (no check script found)");
    else console.log("site post check passed:", chk.script);
  } catch (e) {
    await fail(e.message);
    return;
  }
  console.log("running astro build + check-blog-build …");
  try {
    const buildEnv = { ...process.env, GSC_SERVICE_ACCOUNT_JSON: undefined };
    execSync("npm run build", { cwd: SITE_DIR, stdio: "pipe", timeout: 600000, env: buildEnv });
    if (existsSync(join(SITE_DIR, "scripts/check-blog-build.mjs"))) {
      execFileSync("node", ["scripts/check-blog-build.mjs"], { cwd: SITE_DIR, stdio: "pipe", timeout: 120000, env: buildEnv });
    }
  } catch (e) {
    const raw = String(e.stdout || "") + String(e.stderr || "");
    const lines = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
    await fail(`site build failed:\n${lines.slice(-30).join("\n") || "(no output captured from build)"}`);
    return;
  }
  console.log("build passed");

  // 8) commit + PR (skipped in DRY_RUN)
  if (DRY_RUN) { console.log("=== DRY RUN — would open PR ==="); console.log(`title: content: add ${article.slug}`); console.log(`branch: blog/${article.slug}`); console.log(`description: ${article.description}`); return; }
  if (!HENDRANICHOLAS_PAT) await fail("HENDRANICHOLAS_PAT not set");
  const gitEnv = { ...process.env, GH_TOKEN: HENDRANICHOLAS_PAT };
  const git = (args) => execFileSync("git", args, { cwd: SITE_DIR, stdio: "pipe", env: gitEnv }).toString();
  const prBodyPath = join(SITE_DIR, ".pr-body.md");
  const branch = `blog/${article.slug}`;
  try {
    const remote = git(["ls-remote", "--heads", "origin", branch]).trim();
    if (remote) { await fail(`remote branch ${branch} already exists (likely from a previous run); refusing to force-push — delete it or resolve the slug collision yourself, then re-run`); return; }
  } catch {}
  try { git(["checkout", "-B", branch]); } catch (e) { await fail(`git checkout: ${String(e.message).slice(0, 200)}`); return; }
  git(["add", "src/content/blog", "src/assets/blog"]);
  git(["-c", "user.name=hendranicholas-bot", "-c", "user.email=bot@hendranicholas.com", "commit", "-m", `content: add ${article.slug}`]);
  git(["push", "-u", "origin", branch]);
  const prBody = `## Summary\n- Article: **${article.title}** (category: ${article.category}, keyword: ${article.keyword}, ~${v.wordCount} words)\n- Service angle: ${(article.services || []).join(", ") || "(none)"}\n- Generated by the hendranicholas-blog-writer pipeline; auto-merged after astro build passed.\n\n## Sources\n- ${chosenSignal?.url ? `Signal: ${chosenSignal.url}; every readable cited page fetched and grounding-checked.` : "Evergreen tutorial; every readable cited page fetched and grounding-checked."}\n\n## Validation\n- [x] astro build passed\n- [x] description ${article.description.length}c · keyword in intro\n- [x] ${groundedLinks} external citations fetched and grounding-checked (unreadable ones logged as warnings)`;
  writeFileSync(prBodyPath, prBody);
  const pr = execFileSync("gh", ["pr", "create", "--base", "main", "--head", branch, "--title", `content: add ${article.slug}`, "--body-file", prBodyPath], { cwd: SITE_DIR, env: gitEnv, stdio: "pipe" }).toString().trim();
  try { unlinkSync(prBodyPath); } catch {}
  console.log("PR opened:", pr);
  const knownLocs = await sitemapLocs(SITE_URL);
  const m = mergePr(pr, { env: gitEnv });
  if (m.merged) console.log("PR merged:", pr);
  else console.log(`::warning title=Auto-merge failed::${m.error} — PR ${pr} left open; merge it by hand.`);
  const rec = await recordPublished({
    pipeline: PIPELINE,
    dryRun: DRY_RUN,
    items: [{
      item_key: article.slug,
      title: article.title,
      url: chosenSignal?.url || "",
      meta: { keyword: article.keyword, topic: topic.topic, category: article.category, pr },
    }],
  });
  console.log(`published ledger: recorded ${rec.inserted} item(s)`);
  const ix = m.merged ? await indexArticle({ siteUrl: SITE_URL, slug: article.slug, indexNowKey: INDEXNOW_KEY, env: process.env, knownLocs }) : null;
  if (ix) console.log("indexing:", JSON.stringify(ix));
  try { await postToSlack([m.merged
    ? `🖌️ _hendranicholas.com article published_\n*${article.title}*\n→ ${pr}\n${v.wordCount} words · category: ${article.category} · keyword: ${article.keyword}\n${ix.live ? `🔎 ${ix.url} · Bing: ${ix.bing} · Google sitemap: ${ix.google}` : `🔎 not live after 10 min — search engines not notified. Once it is deployed: \`node scripts/site-index.mjs ${SITE_URL} ${article.slug} ${INDEXNOW_KEY}\``}`
    : `🖌️ _hendranicholas.com PR opened — auto-merge failed_\n*${article.title}*\n→ ${pr}\n${m.error}\nMerge it by hand.`]); }
  catch (e) { console.log(`::warning title=Slack summary not posted::${e.message} — PR ${pr} was opened; check the Slack channel secret / bot membership.`); }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch(async (e) => { await fail(`unexpected error: ${String(e).slice(0, 300)}`); });
}
