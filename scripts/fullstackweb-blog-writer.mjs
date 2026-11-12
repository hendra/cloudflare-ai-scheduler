#!/usr/bin/env node
import { callModel } from "./ai-providers.mjs";
import { generateCover } from "./cover/render.mjs";
// FullstackWeb.dev blog writer (pilot, PR-only) — deterministic, zero dependencies.
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

import { readFileSync, readdirSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { join } from "node:path";

const DRY_RUN = String(process.env.DRY_RUN || "false") === "true";
const AI_STUB = process.env.AI_STUB === "true";
const SITE_DIR = process.env.SITE_DIR || "fullstackweb-site";
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
async function headOk(url) {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0" }, signal: ctrl.signal, redirect: "follow" });
    clearTimeout(t);
    return res.status < 400;
  } catch { return false; }
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
function loadCorpus(dir) {
  const blogDir = join(dir, "src/content/blog");
  const out = [];
  for (const f of readdirSync(blogDir)) {
    if (!f.endsWith(".md")) continue;
    const m = readFileSync(join(blogDir, f), "utf8").match(/^title:\s*(.+)$/m);
    out.push({ slug: f.replace(/\.md$/, ""), title: m ? m[1].replace(/^["']|["']$/g, "").trim() : f });
  }
  return out;
}

// ---------- AI-stub article (offline testing only) ----------
function stubArticle() {
  const body = `## Why this matters\n\nA typescript migration done incrementally avoids entire categories of bugs. ${"Stubbed section on the core tradeoffs. ".repeat(90)}\n\n## How to start\n\n\`\`\`bash\n# install and configure the compiler\nnpm install typescript\nnpx tsc --init\n\`\`\`\n\n${"TypeScript compiler options explained step by step. ".repeat(90)}\n\n## Common mistakes\n\n${"Patterns to avoid when adopting types incrementally, drawn from real projects. ".repeat(90)}\n\n## Verification\n\n> Verification note: stubbed content for pipeline testing only. Not for publication.\n\n## FAQ\n\n${"Frequently asked questions and direct answers. ".repeat(70)}\n\n## Conclusion\n\n${"Wrap-up and next steps for your team. ".repeat(70)}`;
  return { title: "Migrating a Large Editor to TypeScript: A Practical Guide", description: "Practical guide to migrating large JavaScript codebases to TypeScript without a big-bang rewrite: tsconfig strategy, incremental adoption, and CI gating that keeps the build green.", keyword: "typescript migration", slug: "typescript-migration-large-codebase-guide", category: "Node.js and TypeScript", services: ["nodejs-typescript-development", "full-stack-development"], coverAlt: "Diagram of a staged TypeScript migration: deprecated options cleaned first, then the native compiler replaces type-checking", body };
}

// ---------- metadata helpers ----------
const DESC_MAX_CHARS = 180; // validation limit for description (prompt targets 120-160)
const MIN_BODY_WORDS = 1500; // hard body-length gate, shared by generation and validation
const countWords = (t) => String(t || "").trim().split(/\s+/).filter(Boolean).length;
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
const META_ERR = /^(title length|description|slug format|slug already exists|keyword)/;
const isMetaErr = (e) => META_ERR.test(e);

// ---------- validation ----------
function validateArticle(a, corpusSlugs) {
  const errs = [];
  const req = (cond, msg) => { if (!cond) errs.push(msg); };
  req(a.title && a.title.length >= 20 && a.title.length <= 120, "title length");
  
  req(a.description && a.description.length >= 100 && a.description.length <= 180, `description ${a?.description?.length} not in 100-180`);
  req(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.slug || ""), "slug format");
  // Services are required by the FullstackWeb.dev schema (astro check). Tolerate model mistakes:
  // drop unknown slugs, and if none remain, pick the closest by simple keyword heuristics.
  if (!Array.isArray(a.services) || a.services.length === 0) a.services = [];
  a.services = a.services.filter((x) => SERVICE_VALUES.includes(x));
  if (a.services.length === 0) {
    const guess = ((a.keyword || "") + " " + (a.title || "")).toLowerCase();
    if (/\b(agent|llm|gemini|claude|ai)\b/i.test(guess)) a.services = ["ai-engineering", "ai-agent-development"];
    else if (/\b(react|next\.?js|react\.?js|vite|frontend)\b/i.test(guess)) a.services = ["react-nextjs-development"];
    else if (/\b(typescript|node\.?js|nodejs)\b/i.test(guess)) a.services = ["nodejs-typescript-development"];
    else if (/\b(rails|ruby)\b/i.test(guess)) a.services = ["ruby-on-rails-development"];
    else if (/\b(devops|kubernetes|k8s|cloud|docker|deploy)\b/i.test(guess)) a.services = ["cloud-devops"];
    else if (/\b(api|backend|rest|graphql)\b/i.test(guess)) a.services = ["backend-api-development"];
    else a.services = ["full-stack-development"];
    console.warn("services: fallbacks applied ->", a.services);
  }
  req(!corpusSlugs.includes(a.slug), "slug already exists");
  req((() => {
    const lines = String(a.body || "").split("\n");
    let inFence = false, hasH1 = false;
    for (const line of lines) { if (line.trimStart().startsWith("```")) inFence = !inFence; else if (!inFence && /^# /.test(line)) hasH1 = true; }
    return !hasH1;
  })(), "body contains H1 (#)");
  const h2 = (a.body.match(/^## /gm) || []).length;
  req(h2 >= 4, `only ${h2} H2 sections (need >= 4)`);
  const fences = (a.body.match(/^```/gm) || []).length;
  req(fences % 2 === 0, "unbalanced code fences");
  const words = countWords(a.body);
  req(words >= MIN_BODY_WORDS, `only ${words} words (need >= ${MIN_BODY_WORDS})`);
  const bodyNoFences = String(a.body || "").split(/```/).filter((_, i) => i % 2 === 0).join("\n");
  req(!/lorem(?:\s|_)ipsum|\{placeholder\}|\[insert/i.test(bodyNoFences), "placeholder token in body");
  // fullstackwebdev-site schema: category is z.string() (no enum), but it lands in YAML
  // frontmatter unquoted below — enforce a non-empty, short, single-line string so a
  // hostile model reply can't inject extra frontmatter keys. Fallback to a sane default.
  a.category = String(a.category || "").replace(/[\r\n]+/g, " ").trim().slice(0, 60);
  if (!a.category) a.category = "Dev Tools";
  // Keyword check: require at least the first two significant words (was: only the first;
  // full-all-words was deliberately relaxed in d0be839 for model tolerance — see git log).
  const kw = a.keyword || "";
  const norm = (t) => String(t || "").toLowerCase().replace(/[\u2010\u2011\u2012\u2013\u2014-]/g, " ").replace(/\s+/g, " ").trim();
  const kwWords = norm(kw).split(/\s+/).filter((w) => w.length > 2);
  const hay = norm((a.title || "") + " " + (a.description || "") + " " + bodyNoFences.slice(0, 2000));
  req(kwWords.slice(0, 2).every((w) => hay.includes(w)), "keyword words missing from title/description/intro");
  req(/verification note/i.test(a.body), "no verification note");
  const links = a.body.match(/\]\((https?:\/\/[^)\s]+)\)/g) || [];
  return { ok: errs.length === 0, errs, wordCount: words, links: [...new Set(links.map((l) => l.slice(2, -1)))].slice(0, 15) };
}

// ---------- frontmatter ----------
function frontmatter(a) {
  const svcLines = Array.isArray(a.services) && a.services.length > 0 ? `services: [${a.services.map((x) => `"${x}"`).join(", ")}]\n` : "";
  const d = new Date();
  const pub = new Date(d.getTime() + 7 * 3600_000).toISOString().replace(/\.\d+Z$/, "+07:00");
  const svcLine = svcLines.trim() ? svcLines : "";
  const cat = a.category ? `category: ${JSON.stringify(a.category)}\n` : "";
  return `---\ntitle: ${JSON.stringify(a.title)}\ndescription: ${JSON.stringify(a.description)}\n${cat}pubDate: ${pub}\n${svcLine}cover: "../../assets/blog/${a.slug}.png"\ncoverAlt: ${JSON.stringify(a.coverAlt)}\ndraft: false\n---\n\n${a.body.trim()}\n`;
}

// ---------- main ----------
(async () => {
  if (!existsSync(join(SITE_DIR, "package.json"))) await fail(`site checkout not found at ${SITE_DIR} (set SITE_DIR)`);
  const corpus = loadCorpus(SITE_DIR);
  const corpusSlugs = corpus.map((c) => c.slug);
  console.log(`corpus: ${corpus.length} existing posts`);

  // 1) signals
  const signals = [];
  try { signals.push(...parseTrending((await fetchText("https://github.com/trending?since=daily")).text)); console.log(`trending: ${signals.length}`); } catch (e) { console.error("trending fetch failed:", e.message); }
  try {
    const hn = JSON.parse((await fetchText("https://hn.algolia.com/api/v1/search_by_date?tags=front_page&hitsPerPage=30")).text);
    const hnStories = (hn.hits || []).filter((h) => (h.points || 0) >= 30).map((h) => ({ source: "hacker-news", title: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, description: h.title, signals: `${h.points} points, ${h.num_comments} comments` }));
    signals.push(...hnStories);
    console.log(`hn front page: ${hnStories.length}`);
  } catch (e) { console.error("hn fetch failed:", e.message); }
  if (signals.length === 0) await fail("all signal sources failed");

  // 2) topic selection
  const topicPrompt = `You pick ONE blog topic for FullstackWeb.dev (fullstackweb.dev) — independent senior full-stack and AI engineer; readers: senior developers and tech leads; pillars: AI engineering, React and Next.js, Node.js and TypeScript, Ruby on Rails, backend APIs, cloud and DevOps, developer tools, open source. Pick the signal with the strongest, most durable angle for that audience.
Reply with ONLY this JSON (no prose): {"topic":"short topic","keyword":"primary keyword","angle":"one-line angle","rationale":"why this wins","title":"article H1, 20-120 chars","description":"120-160 chars","slug":"kebab-case-slug","category":"one of: Dev Tools|Web/Frontend|AI/LLM|Backend|Infra/DevOps|Data|Ruby on Rails","services":[${JSON.stringify(SERVICE_VALUES)}]}
Avoid all of these existing posts: ${corpus.slice(0, 80).map((c) => c.title).join(" | ")}
Signals:
${signals.map((s, i) => `${i + 1}. [${s.source}] ${s.title} — ${s.description.slice(0, 160)} (${s.signals})`).join("\n")}`;
  let topic = AI_STUB ? { topic: "Fullstack TypeScript migration strategy", keyword: "typescript migration", angle: "practical guide", rationale: "stub", title: "Migrating a Large Editor to TypeScript: A Practical Guide", description: "Practical guide to migrating large JavaScript codebases to TypeScript without a big-bang rewrite: tsconfig strategy, incremental adoption, and CI gating that keeps the build green.", slug: "typescript-migration-large-codebase-guide", category: "Node.js and TypeScript", services: ["nodejs-typescript-development", "full-stack-development"], coverAlt: "Diagram of a staged TypeScript migration: deprecated options cleaned first, then the native compiler replaces type-checking" } : null;
  if (!topic) {
    for (let attempt = 1; attempt <= 3 && !topic; attempt++) {
      try { topic = parseJSONObject(await callModel(topicPrompt + (attempt > 1 ? "\n\nPrevious reply invalid; reply with ONLY the JSON object." : ""), { maxTokens: 4096 })); }
      catch (e) { console.error(`topic attempt ${attempt}:`, e.message); }
    }
    if (!topic) await fail("topic selection failed after 3 attempts");
  }
  const meta = topic; // meta is emitted in the same JSON object as the topic
  console.log(`topic: ${topic.topic} | keyword: ${topic.keyword} | angle: ${topic.angle}`);
  console.log(`meta: ${meta.title} | ${meta.slug}`);

  // 3) article body (metadata already produced in the topic call)
  const existingLinks = corpus.slice(0, 40).map((c) => `/blog/${c.slug} — ${c.title}`).join("\n");
  const bodyPrompt = `Write the body of one FullstackWeb.dev (fullstackweb.dev) blog article in English: first person, senior full-stack and AI engineer voice — practical, specific, opinionated, honest about uncertainty, no marketing copy.
Topic: ${topic.topic}. Keyword: "${meta.keyword}". Angle: ${topic.angle}. Title: ${meta.title}.
Requirements:
- 1800-2400 words. H2/H3 sections only, never a # H1 line.
- At least one fenced code example (typescript, javascript, ruby, bash, or whatever fits the topic).
- An explicit blockquote "Verification note" for anything unverified; never invent benchmarks, versions, dates or statistics.
- At most 2 internal links to these existing posts:
${existingLinks}
- Reference ONLY real URLs (official docs and the like). If a fact can't be verified, say so in the verification note rather than asserting it.
- Be concrete: real file paths, real flags, real package names. Generic AI/placeholder advice is not acceptable.
Return ONLY the article body as markdown: the opening paragraph and "##" sections. No title, no frontmatter, no preamble, no trailing notes.`;
  const body = AI_STUB ? stubArticle().body : await (async () => {
    let lastWords = 0;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const hint = attempt > 1 ? `\n\nYour previous attempt was too short (${lastWords} words). Write at least ${MIN_BODY_WORDS} words. Return ONLY the markdown body.` : "";
      try {
        const text = await callModel(bodyPrompt + hint, { maxTokens: 8000, expectJSON: false });
        lastWords = countWords(text);
        if (lastWords >= MIN_BODY_WORDS) return text.replace(/^```(?:markdown)?\n/, "").replace(/\n```$/, "").trim();
        console.error(`body attempt ${attempt}: too short (${lastWords} words, need >= ${MIN_BODY_WORDS})`);
      } catch (e) { console.error(`body attempt ${attempt}:`, e.message); }
    }
    return null;
  })();
  if (!body) await fail("article body generation failed after 3 attempts");
  const article = { ...meta, body };
  if (article.description && article.description.length > DESC_MAX_CHARS) {
    const clamped = clampAtWord(article.description, DESC_MAX_CHARS);
    console.log(`description clamped: ${article.description.length}c -> ${clamped.length}c`);
    article.description = clamped;
  }
  console.log(`article: ${article.title} | ${article.slug}`);

  // 4) validation (with one self-correction retry)
  let v = validateArticle(article, corpusSlugs);
  // 4a) metadata self-correction — the body-only retry below cannot fix these
  if (!v.ok && v.errs.some(isMetaErr)) {
    console.error("metadata validation failed, requesting metadata fix:", v.errs.join("; "));
    try {
      const metaNow = Object.fromEntries(META_KEYS.map((k) => [k, article[k]]));
      const fixPrompt = `You previously produced this blog metadata JSON for fullstackweb.dev:\n${JSON.stringify(metaNow)}\nIt failed validation: ${v.errs.filter(isMetaErr).join("; ")}.\nReturn ONLY a corrected JSON object with exactly the same keys. Hard constraints:\n- title: 20-120 chars\n- description: 120-160 chars (hard max 180) and MUST contain "${article.keyword}"\n- keyword: keep "${article.keyword}" unless it cannot fit; primary keyword only\n- slug: kebab-case (a-z0-9 and hyphens), NOT any of: ${corpusSlugs.slice(0, 60).join(", ")}\n- category: one of Dev Tools | Web/Frontend | AI/LLM | Backend | Infra/DevOps | Data | Ruby on Rails\nOutput ONLY the JSON object, no prose.`;
      const fixed = parseJSONObject(await callModel(fixPrompt, { maxTokens: 2048 }));
      if (fixed && typeof fixed === "object") {
        for (const k of META_KEYS) if (typeof fixed[k] === "string" && fixed[k].trim()) article[k] = fixed[k].trim();
        if (article.description && article.description.length > DESC_MAX_CHARS) article.description = clampAtWord(article.description, DESC_MAX_CHARS);
        v = validateArticle(article, corpusSlugs);
        console.log(v.ok ? "validation ok after metadata fix" : `still failing after metadata fix: ${v.errs.join("; ")}`);
      }
    } catch (e) { console.error("metadata fix call failed:", e.message); }
  }
  if (!v.ok) {
    console.error("validation failed, retrying body with feedback:", v.errs.join("; "));
    // Validate every retry: a regenerated body can fix one error and introduce another
    // (e.g. reach 1500 words but drop the verification note), so feed fresh errors forward.
    const retryBody = await (async () => {
      let last = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const prompt = bodyPrompt + `\n\nYour previous draft failed validation: ${v.errs.join("; ")}. Return a corrected markdown body that fixes these issues while still meeting EVERY requirement above (length, H2 sections, code example, verification note blockquote). Return ONLY the body.`;
          const text = await callModel(prompt, { maxTokens: 8000, expectJSON: false });
          if (countWords(text) < MIN_BODY_WORDS) { console.error(`retry body attempt ${attempt}: too short`); continue; }
          last = text.replace(/^```(?:markdown)?\n/, "").replace(/\n```$/, "").trim();
          v = validateArticle({ ...article, body: last }, corpusSlugs);
          if (v.ok) return last;
          if (v.errs.every(isMetaErr)) { console.error("retry body: only metadata errors remain; a body rewrite cannot fix them"); break; }
          console.error(`retry body attempt ${attempt} still failing: ${v.errs.join("; ")}`);
        } catch (e) { console.error(`retry body attempt ${attempt}:`, e.message); }
      }
      return last;
    })();
    if (retryBody) {
      article.body = retryBody;
      v = validateArticle(article, corpusSlugs);
      if (v.ok) { console.log(`validation ok after retry — ${v.wordCount} words, ${v.links.length} links`); } else { await fail(`article validation failed after retry: ${v.errs.join("; ")}`); return; }
    } else { await fail(`article validation failed: ${v.errs.join("; ")}`); return; }
  } else {
    console.log(`validation ok — ${v.wordCount} words, ${v.links.length} external links to check`);
  }

  // 4b) external link check (drop article if >2 dead)
  let dead = 0;
  for (const url of v.links) { if (!(await headOk(url))) { dead++; console.warn("dead link:", url); } }
  if (dead > 2) await fail(`article has ${dead} dead external links`);
  if (dead > 0) console.warn(`warning: ${dead} dead link(s) present; PR body will flag them`);

  // 5) cover
  const coverPath = join(SITE_DIR, "src/assets/blog", `${article.slug}.png`);
  try { article.coverAlt = await generateCover({ site: "fullstackweb", article, siteDir: SITE_DIR, outPath: coverPath, callModel, stub: AI_STUB }); console.log("cover generated:", coverPath); } catch (e) { await fail(e.message); return; }

  // 6) write .md
  const mdPath = join(SITE_DIR, "src/content/blog", `${article.slug}.md`);
  writeFileSync(mdPath, frontmatter(article));
  console.log("wrote", mdPath);

  // 7) build must pass
  console.log("running astro check && astro build …");
  try { execSync("npm run build", { cwd: SITE_DIR, stdio: "pipe", timeout: 600000, env: { ...process.env } }); }
  catch (e) {
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
  const prBody = `## Summary\n- Article: **${article.title}** (keyword: ${article.keyword}, ~${v.wordCount} words)\n- Service angle: ${article.service || "(none)"}\n- Generated by the fullstackweb-blog-writer pilot pipeline from signals + corpus review; **requires human review before merge**.\n\n## Sources\n- Topic from signals; external links in the article are HEAD-verified.\n\n## Validation\n- [x] astro check && astro build passed\n- [x] description ${article.description.length}c · keyword in title/desc/intro\n- [x] ${v.links.length} external links HEAD-checked (${dead} dead)\n- [ ] **Human: verify version numbers, code examples run, and the voice matches the site.**\n\nDO NOT MERGE WITHOUT REVIEW.`;
  writeFileSync(prBodyPath, prBody);
  const pr = execFileSync("gh", ["pr", "create", "--base", "main", "--head", branch, "--title", `content: add ${article.slug}`, "--body-file", prBodyPath], { cwd: SITE_DIR, env: gitEnv, stdio: "pipe" }).toString().trim();
  try { unlinkSync(prBodyPath); } catch {}
  console.log("PR opened:", pr);
  // The PR is the deliverable; a Slack summary failure (e.g. channel_not_found) must not fail the run.
  try { await postToSlack([`🖌️ _FullstackWeb.dev draft PR ready_\n*${article.title}*\n→ ${pr}\n${v.wordCount} words · keyword: ${article.keyword} · needs your review before merge.`]); }
  catch (e) { console.log(`::warning title=Slack summary not posted::${e.message} — PR ${pr} was opened; check the Slack channel secret / bot membership.`); }
})().catch(async (e) => { await fail(`unexpected error: ${String(e).slice(0, 300)}`); });
