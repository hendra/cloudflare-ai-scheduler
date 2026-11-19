#!/usr/bin/env node
import { callModel, LONGFORM_MODELS } from "./ai-providers.mjs";
import { generateCover } from "./cover/render.mjs";
import { mergePr } from "./site-pr.mjs";
import { indexArticle, sitemapLocs } from "./site-index.mjs";
import { groundArticle } from "./blog-grounding.mjs";
import { fetchSourceText } from "./grounding.mjs";
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
// FullstackWeb.dev blog writer (PR + auto-merge) — deterministic, zero dependencies.
//
// Flow: fetch signals (HN front page + GitHub Trending) → load existing corpus
//   (title/slug list, blocks duplicates) → 1 AI completion picks a topic (metadata
//   included) → 1 AI completion writes the markdown article body (hard-validated) →
//   cover rendered by headless Chrome (scripts/cover/) → write .md + cover into the
//   site checkout → `npm run build` must pass → branch → commit → push → PR →
//   Slack #fullstackwebdev summary. Any hard failure → Slack note, NO push, NO PR.
//
// Env:
//   SITE_DIR        path to the fullstackweb-site checkout (default: "fullstackweb-site")
//   DRY_RUN=true    everything except git push / PR / Slack (build still runs)
//   AI_STUB=true    deterministic fake article (offline testing; never pushed)
//   AI_PROVIDER / AI_FALLBACKS / AI_MODEL / <PROVIDER>_MODEL  (same as digests)
//   FULLSTACKWEB_PAT PAT with Contents RW + PR write on hendra/fullstackwebdev-site
//   SLACK_BOT_TOKEN, SLACK_FULLSTACKWEBDEV_CHANNEL_ID   (for the final summary note)
//   PUBLIC_FORMSPREE_FORM_ID  (astro env schema requires it at build time)
// Exit: 0 ok (PR opened or dry-run printed), 1 failure (Slack note attempted).

import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PIPELINE = "blog:fullstackweb";

const DRY_RUN = String(process.env.DRY_RUN || "false") === "true";
const AI_STUB = process.env.AI_STUB === "true";
const SITE_DIR = process.env.SITE_DIR || "fullstackweb-site";
const SITE_URL = "https://fullstackweb.dev";
const INDEXNOW_KEY = "3eacbfaa1e224de7899cdbf42fac1c59"; // public key file: https://fullstackweb.dev/3eacbfaa1e224de7899cdbf42fac1c59.txt
const FULLSTACKWEB_PAT = process.env.FULLSTACKWEB_PAT || "";
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const SLACK_CHANNEL = process.env.SLACK_FULLSTACKWEBDEV_CHANNEL_ID || "";
const SERVICE_VALUES = [
  "full-stack-development",
  "nodejs-typescript-development",
  "react-nextjs-development",
  "backend-api-development",
  "cloud-devops",
  "ruby-on-rails-development",
  "python-fastapi-development",
  "ai-engineering",
  "ai-agent-development",
  "rag-llm-development",
];
// Mirrors BLOG_CATEGORIES in hendra/fullstackwebdev-site src/content.config.ts.
export const CATEGORY_VALUES = [
  "AI Engineering",
  "Backend",
  "Frontend",
  "Dev Tools",
  "DevOps",
  "Node.js and TypeScript",
  "Python and FastAPI",
  "Rust",
  "Engineering Leadership",
];
const CATEGORY_ALIASES = {
  "ai/llm": "AI Engineering",
  "web/frontend": "Frontend",
  "infra/devops": "DevOps",
  "data": "Backend",
  "ruby on rails": "Backend",
};
const strip = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

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
    // Only claim failure-posted when Slack actually accepted the note; the
    // workflow falls back to its own note otherwise.
    const posted = await postToSlack([`⚠️ _FullstackWeb.dev blog writer failed:_ ${msg}`.slice(0, 500)]);
    if (posted) { try { writeFileSync("failure-posted", "1"); } catch {} }
  } catch {}
  process.exit(1);
}

// Returns true only when every message was accepted by Slack. In DRY_RUN or with
// missing credentials it logs and returns false (nothing was really posted).
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
function stubArticle() {
  const body = `A typescript migration replaces untyped JavaScript files with strict TypeScript modules incrementally so teams keep shipping features without halting product work for a rewrite. ${"Stubbed lead context on staging compiler checks cleanly. ".repeat(4)}

## Why incremental adoption beats a big-bang rewrite

An incremental approach avoids multi-month merge conflicts and keeps CI green. For official compiler flags, consult the [TypeScript migration handbook](https://www.typescriptlang.org/docs/handbook/migrating-from-javascript.html) and my [Node.js and TypeScript service](/services/nodejs-typescript-development/). ${"Stubbed section on the core tradeoffs. ".repeat(90)}

| Phase | Configuration | CI Enforcement |
| --- | --- | --- |
| Baseline | allowJs with checkJs off | Existing tests pass |
| Strict modules | strictNullChecks enabled | Per-directory typecheck |

## How to configure tsconfig for mixed codebases

\`\`\`bash
# install and configure the compiler
npm install typescript
npx tsc --init
\`\`\`

${"TypeScript compiler options explained step by step. ".repeat(90)}

## Common mistakes when migrating legacy modules

${"Patterns to avoid when adopting types incrementally, drawn from real projects. ".repeat(90)}

## Verification

> Verification note: stubbed content for pipeline testing only. Not for publication.

## Frequently asked questions

### Should we enable strict mode on day one?

No — start with allowJs and incrementally tighten compiler flags per package so existing pull requests keep landing cleanly.

### How do we type third-party libraries without bundled definitions?

Install matching @types packages first and isolate any remaining untyped imports behind a local declaration file.

### Can JavaScript and TypeScript files live in the same package?

Yes, setting allowJs in tsconfig lets both file extensions coexist during the migration window.

## Conclusion

Start with a small shared utility folder, enforce type-checking in CI, and expand coverage module by module. If you need architecture support, [get in touch](/contact/). ${"Wrap-up and next steps for your engineering workflow. ".repeat(65)}`;
  return { title: "Migrating a Large Editor to TypeScript: A Practical Guide", description: "Practical guide to migrating large JavaScript codebases to TypeScript without a big-bang rewrite: tsconfig strategy, incremental adoption, and CI gating that keeps the build green.", keyword: "typescript migration", slug: "typescript-migration-large-codebase-guide", category: "Node.js and TypeScript", services: ["nodejs-typescript-development", "full-stack-development"], coverAlt: "Diagram of a staged TypeScript migration: deprecated options cleaned first, then the native compiler replaces type-checking", body };
}

// ---------- metadata helpers ----------
const DESC_MAX_CHARS = 180; // validation limit for description (prompt targets 120-160)
const MIN_BODY_WORDS = 1500; // hard body-length gate, shared by generation and validation
// Clamp to max chars at a word boundary; hard cut if there is no decent boundary.
function clampAtWord(s, max) {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  const base = at >= 40 ? cut.slice(0, at) : t.slice(0, max);
  return base.trim().replace(/[\s.,;:!?—–-]+$/u, "");
}
const META_KEYS = ["title", "description", "keyword", "slug", "category"];

export function normalizeCategory(raw, { title = "", keyword = "", services = [] } = {}) {
  const clean = String(raw || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const lower = clean.toLowerCase();
  const exact = CATEGORY_VALUES.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;
  if (CATEGORY_ALIASES[lower]) return CATEGORY_ALIASES[lower];

  const guess = `${clean} ${title || ""} ${keyword || ""} ${Array.isArray(services) ? services.join(" ") : ""}`;
  if (/\brust\b/i.test(guess)) return "Rust";
  if (/\b(python|fastapi|django|flask|pydantic)\b/i.test(guess)) return "Python and FastAPI";
  if (/\b(node\.?js|nodejs|typescript|nestjs|fastify|hono)\b/i.test(guess)) return "Node.js and TypeScript";
  if (/\b(react|next\.?js|nextjs|vite|frontend|tailwind|css|browser)\b/i.test(guess)) return "Frontend";
  if (/\b(ai|llm|rag|agent|claude|gemini|openai|machine learning)\b/i.test(guess)) return "AI Engineering";
  if (/\b(devops|kubernetes|k8s|docker|ci\/cd|terraform|cloud|deploy|infra)\b/i.test(guess)) return "DevOps";
  if (/\b(backend|api|postgres|postgresql|redis|sql|rails|ruby|graphql|microservices)\b/i.test(guess)) return "Backend";
  if (/\b(leadership|staff engineer|principal|management|hiring|fractional|architecture review)\b/i.test(guess)) return "Engineering Leadership";
  return "Dev Tools";
}

function normalizeServices(a) {
  const filtered = Array.isArray(a.services)
    ? a.services.filter((x) => SERVICE_VALUES.includes(x))
    : [];
  if (filtered.length > 0) return filtered;
  const guess = ((a.keyword || "") + " " + (a.title || "")).toLowerCase();
  let fallback;
  if (/\b(agent|llm|gemini|claude|ai)\b/i.test(guess)) fallback = ["ai-engineering", "ai-agent-development"];
  else if (/\b(react|next\.?js|react\.?js|vite|frontend)\b/i.test(guess)) fallback = ["react-nextjs-development"];
  else if (/\b(typescript|node\.?js|nodejs)\b/i.test(guess)) fallback = ["nodejs-typescript-development"];
  else if (/\b(rails|ruby)\b/i.test(guess)) fallback = ["ruby-on-rails-development"];
  else if (/\b(devops|kubernetes|k8s|cloud|docker|deploy)\b/i.test(guess)) fallback = ["cloud-devops"];
  else if (/\b(api|backend|rest|graphql)\b/i.test(guess)) fallback = ["backend-api-development"];
  else fallback = ["full-stack-development"];
  console.warn("services: fallbacks applied ->", fallback);
  return fallback;
}

// ---------- validation ----------
export function validateArticle(a, corpusSlugs, extraCfg = {}) {
  // Services are required by the FullstackWeb.dev schema (astro check).
  a.services = normalizeServices(a);
  // fullstackwebdev-site schema requires category in BLOG_CATEGORIES (z.enum).
  const prevCategory = a.category;
  a.category = normalizeCategory(a.category, a);
  if (a.category !== prevCategory) console.warn(`category: normalized ${JSON.stringify(prevCategory)} -> ${JSON.stringify(a.category)}`);
  return validateAeoGeo(a, {
    lang: "en",
    domain: "fullstackweb.dev",
    descMin: 100,
    descMax: DESC_MAX_CHARS,
    minWords: MIN_BODY_WORDS,
    trailingSlash: true,
    servicePrefix: "/services/",
    contactHref: "/contact/",
    conclusionHeading: "Conclusion",
    faqHeading: "Frequently asked questions",
    existingSlugs: corpusSlugs,
    indonesianGuard: true,
    bannedPatterns: [
      [/number one|no\. ?1\b|#1\b|world-class|best-in-class/i, "unverifiable superlative"],
      [/\b(our team|our developers|our engineers)\b/i, 'fullstackweb.dev is one developer: write "I"'],
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
  return `---\ntitle: ${JSON.stringify(a.title)}\ndescription: ${JSON.stringify(a.description)}\n${kwLine}${cat}pubDate: ${pub}\n${svcLine}cover: "../../assets/blog/${a.slug}.png"\ncoverAlt: ${JSON.stringify(a.coverAlt)}\ndraft: false\n---\n\n${a.body.trim()}\n`;
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
    openPrs = loadOpenPrs({ siteDir: SITE_DIR, pat: FULLSTACKWEB_PAT, dryRun: DRY_RUN });
  } catch (e) {
    await fail(`open PR lookup failed: ${String(e?.message || e).slice(0, 220)}`);
    return;
  }
  const history = buildBlogHistory({ corpus, openPrs, publishedRows });
  const corpusSlugs = [...history.slugs];
  console.log(`corpus: ${corpus.length} posts | open PRs: ${openPrs.slugs.size} | D1 ledger: ${publishedRows.length} | total known slugs: ${corpusSlugs.length}`);

  // 1) signals
  const rawSignals = [];
  try { rawSignals.push(...parseTrending((await fetchText("https://github.com/trending?since=daily")).text)); console.log(`trending: ${rawSignals.length}`); } catch (e) { console.error("trending fetch failed:", e.message); }
  try {
    const hn = JSON.parse((await fetchText("https://hn.algolia.com/api/v1/search_by_date?tags=front_page&hitsPerPage=30")).text);
    const hnStories = (hn.hits || []).filter((h) => (h.points || 0) >= 30).map((h) => ({ source: "hacker-news", title: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, description: h.title, signals: `${h.points} points, ${h.num_comments} comments` }));
    rawSignals.push(...hnStories);
    console.log(`hn front page: ${hnStories.length}`);
  } catch (e) { console.error("hn fetch failed:", e.message); }
  if (rawSignals.length === 0) await fail("all signal sources failed");

  const signals = filterUnseenCandidates(rawSignals, { urls: history.urls, titles: history.titles }, {
    getUrl: (s) => s.url,
    getTitle: (s) => s.title,
  });
  console.log(`unseen signals: ${signals.length}/${rawSignals.length} (filtered ${rawSignals.length - signals.length})`);
  if (signals.length === 0) {
    console.log("skipping: no unseen signals remain after deduplication");
    process.exit(0);
  }

  // 2) topic selection
  const avoidPosts = buildBlogAvoidList({ corpus, openPrs, publishedRows, max: 150 });
  const existingKeywords = [...new Set([...corpus.map((c) => c.keyword).filter(Boolean), ...history.keywords])];
  const validBlogPaths = new Set(corpus.filter((c) => !c.draft).map((c) => `/blog/${c.slug}/`));
  const topicPrompt = `You pick ONE blog topic for FullstackWeb.dev (fullstackweb.dev) — independent senior full-stack and AI engineer; readers: senior developers and tech leads; pillars: AI engineering, React and Next.js, Node.js and TypeScript, Ruby on Rails, backend APIs, cloud and DevOps, developer tools, open source. Pick the signal with the strongest, most durable angle for that audience.
Reply with ONLY this JSON (no prose): {"signalIndex":<1..${signals.length}>,"topic":"short topic","keyword":"primary keyword","angle":"one-line angle","rationale":"why this wins","title":"article H1, 20-120 chars","description":"120-160 chars","slug":"kebab-case-slug","category":"one of: ${CATEGORY_VALUES.join("|")}","services":[${JSON.stringify(SERVICE_VALUES)}]}
Avoid all of these existing posts: ${avoidPosts.join(" | ")}
Avoid these existing target keywords: ${existingKeywords.slice(0, 100).join(", ")}
Signals:
${signals.map((s, i) => `${i + 1}. [${s.source}] ${s.title} — ${s.description.slice(0, 160)} (${s.signals})`).join("\n")}`;
  let topic = AI_STUB ? { signalIndex: 1, topic: "Fullstack TypeScript migration strategy", keyword: "typescript migration", angle: "practical guide", rationale: "stub", title: "Migrating a Large Editor to TypeScript: A Practical Guide", description: "Practical guide to migrating large JavaScript codebases to TypeScript without a big-bang rewrite: tsconfig strategy, incremental adoption, and CI gating that keeps the build green.", slug: "typescript-migration-large-codebase-guide", category: "Node.js and TypeScript", services: ["nodejs-typescript-development", "full-stack-development"], coverAlt: "Diagram of a staged TypeScript migration: deprecated options cleaned first, then the native compiler replaces type-checking" } : null;
  let chosenSignal = topic ? (signals[(topic.signalIndex || 1) - 1] || null) : null;
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
        const sigIdx = Number.parseInt(candidate.signalIndex, 10);
        const sig = Number.isInteger(sigIdx) && sigIdx >= 1 && sigIdx <= signals.length ? signals[sigIdx - 1] : null;
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
          feedback = `\n\nPrevious topic(s) rejected (${collisionReasons.join("; ")}); pick a DIFFERENT signal from Signals.`;
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
  const meta = topic; // meta is emitted in the same JSON object as the topic
  console.log(`topic: ${topic.topic} | keyword: ${topic.keyword} | angle: ${topic.angle}`);
  console.log(`meta: ${meta.title} | ${meta.slug}`);

  // 3) article body (metadata already produced in the topic call)
  meta.services = normalizeServices(meta);
  meta.category = normalizeCategory(meta.category, meta);
  const existingLinks = corpus.filter((c) => !c.draft).slice(0, 40).map((c) => `/blog/${c.slug}/ — ${c.title}`);
  // Built from the passed article on every call: a 4a metadata fix can change
  // keyword/title/category/services, and the retry prompt must not demand the stale values.
  // Fetched once: the signal's own page is the only material the first draft can cite safely.
  const signalSource = AI_STUB || !chosenSignal?.url ? "" : (await fetchSourceText(chosenSignal.url)).text;
  const signalText = signalSource.slice(0, 6000);
  if (signalText) console.log(`signal source: ${signalText.length} chars from ${chosenSignal.url}`);
  const sourceBlock = signalText
    ? `\n\nSource material (facts you may state — never state a fact that is not here or in an official doc you can cite):\n${signalText}`
    : "";
  const makeBodyPrompt = (a) => {
    const aeoRules = buildAeoGeoBodyRules({
      siteName: "FullstackWeb.dev",
      lang: "en",
      domain: "fullstackweb.dev",
      voiceRule: 'first person ("I", never "our team" / "our developers" / "our engineers") — independent senior full-stack and AI engineer, practical, specific, opinionated, honest about uncertainty, no marketing copy',
      keyword: a.keyword,
      serviceHref: servicePathFor("fullstackweb", a),
      contactHref: "/contact/",
      ctaInstruction: "End Conclusion with a natural CTA linking to [get in touch](/contact/) (note trailing slash).",
      validPostLinks: existingLinks,
      extraRules: [
        "All internal links MUST include a trailing slash (e.g. /services/.../, /blog/.../, /contact/).",
        "Be concrete: real file paths, real flags, real package names. Generic AI/placeholder advice is not acceptable.",
        "Never publish unverifiable superlatives (number one, #1, world-class, best-in-class) or hourly/project rates.",
      ],
    });
    return `Write the body of one FullstackWeb.dev blog article.
Topic: ${a.topic}. Keyword: "${a.keyword}". Angle: ${a.angle}. Title: ${a.title}.
${aeoRules}
Return ONLY the article body as markdown: the opening paragraph and "##" sections. No title, no frontmatter, no preamble, no trailing notes.${sourceBlock}`;
  };
  const bodyModel = (p) => callModel(p, { maxTokens: 8000, expectJSON: false, prefer: LONGFORM_MODELS });
  // Links the code already knows are inserted, not left to the model (sourceUrl only when fetched,
  // so the grounding gate can read it). Applied to every body before it is validated.
  const withLinks = (a, text) => ensureRequiredLinks(text, { domain: "fullstackweb.dev", lang: "en", serviceHref: servicePathFor("fullstackweb", a), contactHref: "/contact/", contactLabel: undefined, sourceUrl: signalSource ? chosenSignal.url : null, conclusionHeading: "Conclusion" });
  // Owner decision: a body that stays short after expansion is skipped (Slack note, exit 0), not a red run.
  const skipShort = async (words) => {
    const note = `⚠️ _FullstackWeb.dev article skipped — too short:_ *${meta.title}*\nThe body stayed at ${words} words after expansion (need ${MIN_BODY_WORDS}). Nothing was published.`;
    try { await postToSlack([note]); } catch (e) { console.error("skip note failed:", e.message); }
    console.log(`skipping: ${note}`);
    process.exit(0);
  };
  let draft;
  try {
    draft = AI_STUB ? { body: stubArticle().body } : await generateBody({ callModel: bodyModel, prompt: makeBodyPrompt(meta), minWords: MIN_BODY_WORDS });
  } catch (e) { await fail(`article body generation failed: ${String(e?.message || e).slice(0, 300)}`); return; }
  if (!draft.body) await skipShort(draft.words);
  const body = withLinks(meta, draft.body);
  const article = { ...meta, body };
  if (article.description && article.description.length > DESC_MAX_CHARS) {
    const clamped = clampAtWord(article.description, DESC_MAX_CHARS);
    console.log(`description clamped: ${article.description.length}c -> ${clamped.length}c`);
    article.description = clamped;
  }
  console.log(`article: ${article.title} | ${article.slug}`);

  // 4) validation (with one self-correction retry)
  const runValidate = (a) => validateArticle(a, corpusSlugs, { existingKeywords, validBlogPaths });
  let v = runValidate(article);
  // 4a) metadata self-correction — the body-only retry below cannot fix these
  if (!v.ok && v.errs.some(isMetaErr)) {
    console.error("metadata validation failed, requesting metadata fix:", v.errs.join("; "));
    try {
      const metaNow = Object.fromEntries(META_KEYS.map((k) => [k, article[k]]));
      const fixPrompt = `You previously produced this blog metadata JSON for fullstackweb.dev:\n${JSON.stringify(metaNow)}\nIt failed validation: ${v.errs.filter(isMetaErr).join("; ")}.\nReturn ONLY a corrected JSON object with exactly the same keys. Hard constraints:\n- title: 20-120 chars\n- description: 120-160 chars (hard max 180) and MUST contain "${article.keyword}"\n- keyword: keep "${article.keyword}" unless it cannot fit; primary keyword only; NOT any existing target keyword\n- slug: kebab-case (a-z0-9 and hyphens), NOT any of: ${corpusSlugs.slice(0, 60).join(", ")}\n- category: one of ${CATEGORY_VALUES.join(" | ")}\nOutput ONLY the JSON object, no prose.`;
      const fixed = parseJSONObject(await callModel(fixPrompt, { maxTokens: 2048 }));
      if (fixed && typeof fixed === "object") {
        for (const k of META_KEYS) if (typeof fixed[k] === "string" && fixed[k].trim()) article[k] = fixed[k].trim();
        if (article.description && article.description.length > DESC_MAX_CHARS) article.description = clampAtWord(article.description, DESC_MAX_CHARS);
        v = runValidate(article);
        console.log(v.ok ? "validation ok after metadata fix" : `still failing after metadata fix: ${v.errs.join("; ")}`);
      }
    } catch (e) { console.error("metadata fix call failed:", e.message); }
  }
  if (!v.ok) {
    console.error("validation failed, retrying body with feedback:", v.errs.join("; "));
    // Validate every retry: a regenerated body can fix one error and introduce another
    // (e.g. reach 1500 words but drop the verification note), so feed fresh errors forward.
    // Each attempt expands a short draft instead of restarting.
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

  // 4b) grounding gate: every risky number must come from a cited page or the signal page.
  // Not groundable after one repair call → skip the article cleanly, publish nothing.
  let groundedLinks = v.links.length;
  if (!AI_STUB) {
    const g = await groundArticle({ article, links: v.links, signalUrl: chosenSignal?.url || null, signalText: signalSource, callModel: (p) => callModel(p, { maxTokens: 8000, expectJSON: false }) });
    if (!g.ok) {
      const note = `⚠️ _FullstackWeb.dev article skipped — unverifiable facts:_ *${article.title}*\nNumbers not found in any cited source: ${g.unverified.join(", ") || "(none)"}\nUnreadable citations: ${g.deadSources.join(", ") || "(none)"}\nNothing was published.`;
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
  }

  // 5) cover
  const coverPath = join(SITE_DIR, "src/assets/blog", `${article.slug}.png`);
  try { article.coverAlt = await generateCover({ site: "fullstackweb", article, siteDir: SITE_DIR, outPath: coverPath, callModel, stub: AI_STUB }); console.log("cover generated:", coverPath); } catch (e) { await fail(e.message); return; }

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
  if (!FULLSTACKWEB_PAT) await fail("FULLSTACKWEB_PAT not set");
  const gitEnv = { ...process.env, GH_TOKEN: FULLSTACKWEB_PAT };
  const git = (args) => execFileSync("git", args, { cwd: SITE_DIR, stdio: "pipe", env: gitEnv }).toString();
  const prBodyPath = join(SITE_DIR, ".pr-body.md");
  const branch = `blog/${article.slug}`;
  // Refuse to clobber an existing remote branch (could be a human's review edits); fail early instead.
  try {
    const remote = git(["ls-remote", "--heads", "origin", branch]).trim();
    if (remote) { await fail(`remote branch ${branch} already exists (likely from a previous run); refusing to force-push — delete it or resolve the slug collision yourself, then re-run`); return; }
  } catch { /* ls-remote itself failed; let push report the real error */ }
  try { git(["checkout", "-B", branch]); } catch (e) { await fail(`git checkout: ${String(e.message).slice(0, 200)}`); return; }
  git(["add", "src/content/blog", "src/assets/blog"]);
  git(["-c", "user.name=fullstackwebdev-bot", "-c", "user.email=bot@fullstackweb.dev", "commit", "-m", `content: add ${article.slug}`]);
  git(["push", "-u", "origin", branch]);
  const prBody = `## Summary\n- Article: **${article.title}** (keyword: ${article.keyword}, ~${v.wordCount} words)\n- Service angle: ${article.service || "(none)"}\n- Generated by the fullstackweb-blog-writer pilot pipeline from signals + corpus review; auto-merged by the pipeline after astro build passed.\n\n## Sources\n- Topic from signals; every cited page was fetched and the body checked against it.\n\n## Validation\n- [x] astro check && astro build passed\n- [x] description ${article.description.length}c · keyword in title/desc/intro\n- [x] ${groundedLinks} external citations fetched and grounding-checked`;
  writeFileSync(prBodyPath, prBody);
  const pr = execFileSync("gh", ["pr", "create", "--base", "main", "--head", branch, "--title", `content: add ${article.slug}`, "--body-file", prBodyPath], { cwd: SITE_DIR, env: gitEnv, stdio: "pipe" }).toString().trim();
  try { unlinkSync(prBodyPath); } catch {}
  console.log("PR opened:", pr);
  const knownLocs = await sitemapLocs(SITE_URL); // snapshot before merge: only a NEW loc counts as the article
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
      meta: { keyword: article.keyword, topic: topic.topic, pr },
    }],
  });
  console.log(`published ledger: recorded ${rec.inserted} item(s)`);
  // Indexing never fails the run: the article is already published.
  const ix = m.merged ? await indexArticle({ siteUrl: SITE_URL, slug: article.slug, indexNowKey: INDEXNOW_KEY, env: process.env, knownLocs }) : null;
  if (ix) console.log("indexing:", JSON.stringify(ix));
  // The PR (merged or open) is the deliverable; a Slack summary failure (e.g. channel_not_found) must not fail the run.
  try { await postToSlack([m.merged
    ? `🖌️ _FullstackWeb.dev article published_\n*${article.title}*\n→ ${pr}\n${v.wordCount} words · keyword: ${article.keyword}\n${ix.live ? `🔎 ${ix.url} · Bing: ${ix.bing} · Google sitemap: ${ix.google}` : `🔎 not live after 10 min — search engines not notified. Once it is deployed: \`node scripts/site-index.mjs ${SITE_URL} ${article.slug} ${INDEXNOW_KEY}\``}`
    : `🖌️ _FullstackWeb.dev PR opened — auto-merge failed_\n*${article.title}*\n→ ${pr}\n${m.error}\nMerge it by hand.`]); }
  catch (e) { console.log(`::warning title=Slack summary not posted::${e.message} — PR ${pr} was opened; check the Slack channel secret / bot membership.`); }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch(async (e) => { await fail(`unexpected error: ${String(e).slice(0, 300)}`); });
}
