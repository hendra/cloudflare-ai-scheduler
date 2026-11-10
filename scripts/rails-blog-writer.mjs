#!/usr/bin/env node
// RailsDev blog writer (pilot, PR-only) — deterministic, zero dependencies.
//
// Flow: fetch signals (HN front page + GitHub Trending) → load existing corpus
//   (title/slug list, blocks duplicates) → 1 AI completion picks a topic →
//   1 AI completion writes the article (JSON, hard-validated) → ImageMagick
//   text-on-brand cover → write .md + cover into the site checkout →
//   `astro check && astro build` must pass → branch → commit → push → PR →
//   Slack #railsdev summary. Any hard failure → Slack note, NO push, NO PR.
//
// Env:
//   SITE_DIR        path to the railsdev-site checkout (default: "railsdev-site")
//   DRY_RUN=true    everything except git push / PR / Slack (build still runs)
//   AI_STUB=true    deterministic fake article (offline testing; never pushed)
//   AI_PROVIDER / AI_FALLBACKS / AI_MODEL / <PROVIDER>_MODEL  (same as digests)
//   RAILSDEV_PAT    PAT with Contents RW + PR write on hendra/railsdev-site
//   SLACK_BOT_TOKEN, SLACK_RAILSDEV_CHANNEL_ID   (for the final summary note)
//   PUBLIC_FORMSPREE_FORM_ID  (astro env schema requires it at build time)
// Exit: 0 ok (PR opened or dry-run printed), 1 failure (Slack note attempted).

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { join, basename } from "node:path";

const DRY_RUN = String(process.env.DRY_RUN || "false") === "true";
const AI_STUB = process.env.AI_STUB === "true";
const SITE_DIR = process.env.SITE_DIR || "railsdev-site";
const RAILSDEV_PAT = process.env.RAILSDEV_PAT || "";
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const SLACK_CHANNEL = process.env.SLACK_RAILSDEV_CHANNEL_ID || "";
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "";
const CF_API_TOKEN = process.env.CF_API_TOKEN || "";
const AI_PROVIDER = (process.env.AI_PROVIDER || "groq").toLowerCase();
const AI_MODEL = process.env.AI_MODEL || "";

const PROVIDERS = {
  cloudflare: { name: "cloudflare", baseURL: () => `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/v1`, key: () => CF_API_TOKEN, model: () => process.env.CLOUDFLARE_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
  groq:       { name: "groq",       baseURL: () => "https://api.groq.com/openai/v1", key: () => process.env.GROQ_API_KEY || "", model: () => process.env.GROQ_MODEL || "openai/gpt-oss-120b", jsonMode: true },
  cerebras:   { name: "cerebras",   baseURL: () => "https://api.cerebras.ai/v1", key: () => process.env.CEREBRAS_API_KEY || "", model: () => process.env.CEREBRAS_MODEL || "llama-3.3-70b", jsonMode: true },
  gemini:     { name: "gemini",     baseURL: () => "https://generativelanguage.googleapis.com/v1beta/openai", key: () => process.env.GEMINI_API_KEY || "", model: () => process.env.GEMINI_MODEL || "gemini-2.5-flash", jsonMode: true },
  openrouter: { name: "openrouter", baseURL: () => "https://openrouter.ai/api/v1", key: () => process.env.OPENROUTER_API_KEY || "", model: () => process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free" },
  mistral:    { name: "mistral",    baseURL: () => "https://api.mistral.ai/v1", key: () => process.env.MISTRAL_API_KEY || "", model: () => process.env.MISTRAL_MODEL || "mistral-small-latest", jsonMode: true },
};
const AI_FALLBACKS = (process.env.AI_FALLBACKS || "gemini,cerebras,openrouter,cloudflare,mistral").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
const CHAIN = [AI_PROVIDER, ...AI_FALLBACKS.filter((p) => p !== AI_PROVIDER)];
const SERVICE_VALUES = ["MVP Build", "Rails Upgrade", "Custom Module", "AI Integration", "Code Audit"];
const wib = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
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
  try { await postToSlack([`⚠️ _RailsDev blog writer failed:_ ${msg}`.slice(0, 500)]); try { writeFileSync("failure-posted", "1"); } catch {} } catch {}
  process.exit(1);
}

async function postToSlack(messages) {
  if (DRY_RUN || !SLACK_BOT_TOKEN || !SLACK_CHANNEL) { messages.forEach((m) => console.log("[dry] slack:", m.slice(0, 120))); return; }
  for (const text of messages) {
    const res = await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ channel: SLACK_CHANNEL, text }) });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) throw new Error(`Slack post failed: ${body.error || res.status}`);
  }
  console.log(`Slack post: ok (${messages.length})`);
}

// ---------- AI ----------
async function callCompletion(prompt, { forceNoJsonMode = false, maxTokens = 2800, expectJSON = true } = {}) {
  const errors = [];
  for (const name of CHAIN) {
    const p = PROVIDERS[name]; if (!p) { errors.push(`${name}: unknown`); continue; }
    const key = p.key(); if (!key) { console.log(`ai: skip ${name} (no creds)`); continue; }
    const model = AI_MODEL || p.model();
    try {
      const body = { model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature: 0.4, ...(p.jsonMode && expectJSON && !forceNoJsonMode ? { response_format: { type: "json_object" } } : {}) };
      const doFetch = (payload) => fetch(`${p.baseURL()}/chat/completions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let res = await doFetch(body);
      if (!res.ok) {
        const errText = (await res.text()).slice(0, 400);
        if (p.jsonMode && !forceNoJsonMode && errText.includes("json_validate_failed")) {
          console.log(`ai: ${name} rejected JSON validation; retrying without response_format`);
          res = await doFetch({ ...body, response_format: undefined });
          if (res.ok) {
            const data2 = await res.json();
            const raw2 = data2?.choices?.[0]?.message?.content || "";
            if (raw2) { console.log(`ai: ${name} ok (no json mode)`); return raw2; }
          }
          errors.push(`${name}: fallback without response_format also failed`);
          continue;
        }
        errors.push(`${name}: HTTP ${res.status} ${errText}`);
        continue;
      }
      const data = await res.json();
      const raw = data?.choices?.[0]?.message?.content || "";
      if (!raw) { errors.push(`${name}: empty completion`); continue; }
      console.log(`ai: ${name} ok`);
      return raw;
    } catch (e) { errors.push(`${name}: ${String(e).slice(0, 300)}`); }
  }
  throw new Error(`all AI providers failed: ${errors.join(" | ")}`);
}
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
  const body = `## The problem\n\nRails teams keep re-litigating the same decision. ${"Stubbed section on the core tradeoffs. ".repeat(90)}\n\n## How this works\n\n\`\`\`ruby\n# frozen_string_literal: true\nclass Migrator\n  def call\n    ActiveRecord::Migration.maintain_test_schema!\n  end\nend\n\`\`\`\n\n${"Rails internals explained step by step. ".repeat(90)}\n\n## Common mistakes\n\n${"Patterns to avoid when adopting this at scale, drawn from team experience. ".repeat(90)}\n\n## Verification\n\n> Verification note: stubbed content for pipeline testing only. Not for publication.\n\n## FAQ\n\n${"Frequently asked questions and direct answers. ".repeat(70)}\n\n## Conclusion\n\n${"Wrap-up and next steps for your team. ".repeat(70)}`;
  return { title: "Rails Migration Testing: A Practical Guide", seoTitle: "Rails Migration Testing: A Practical Guide", description: "Practical guide to writing and verifying Rails migrations in large apps: PostgreSQL pitfalls, Active Record internals and zero-downtime deploy testing.", keyword: "rails migration testing", slug: "rails-migration-testing-guide", service: "Rails Upgrade", coverAlt: "Diagram of a Rails migration being tested against a PostgreSQL database, with rollback steps", body };
}

// ---------- validation ----------
function validateArticle(a, corpusSlugs) {
  const errs = [];
  const req = (cond, msg) => { if (!cond) errs.push(msg); };
  req(a.title && a.title.length >= 20 && a.title.length <= 120, "title length");
  req(a.seoTitle && a.seoTitle.length <= 49, `seoTitle ${a?.seoTitle?.length} > 49`);
  req(a.description && a.description.length >= 120 && a.description.length <= 160, `description ${a?.description?.length} not in 120-160`);
  req(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.slug || ""), "slug format");
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
  const words = a.body.trim().split(/\s+/).length;
  req(words >= 1500, `only ${words} words (need >= 1500)`);
  for (const line of String(a.body || "").split("\n")) { /* fences-aware scan */ }
  const bodyNoFences = String(a.body || "").split(/```/).filter((_, i) => i % 2 === 0).join("\n");
  req(!/lorem(?:\s|_)ipsum|\{placeholder\}|\[insert/i.test(bodyNoFences), "placeholder token in body");
  const kw = a.keyword || "";
  const kwWords = kw.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  req(kwWords.every((w) => (a.title + " " + a.description + " " + bodyNoFences.slice(0, 2000)).toLowerCase().includes(w)), "keyword words missing from title/description/intro");
  req(/verification note/i.test(a.body), "no verification note");
  const links = a.body.match(/\]\((https?:\/\/[^)\s]+)\)/g) || [];
  return { ok: errs.length === 0, errs, wordCount: words, links: [...new Set(links.map((l) => l.slice(2, -1)))].slice(0, 15) };
}

// ---------- cover ----------
function makeCover(title, outPath) {
  execFileSync("python3", [join("scripts", "make-cover.py"), title, outPath], { stdio: "pipe" });
}

// ---------- frontmatter ----------
function frontmatter(a) {
  const svc = SERVICE_VALUES.includes(a.service) ? `service: "${a.service}"\n` : "";
  const d = new Date();
  const pub = new Date(d.getTime() + 7 * 3600_000).toISOString().replace(/\.\d+Z$/, "+07:00");
  return `---\ntitle: ${JSON.stringify(a.title)}\nseoTitle: ${JSON.stringify(a.seoTitle)}\ndescription: ${JSON.stringify(a.description)}\nkeyword: ${JSON.stringify(a.keyword)}\ncover: "../../assets/blog/${a.slug}.png"\ncoverAlt: ${JSON.stringify(a.coverAlt)}\npubDate: ${pub}\n${svc}---\n\n${a.body.trim()}\n`;
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
  const topicPrompt = `You pick ONE blog topic for RailsDev.io (railsdev.io) — senior Rails consultancy in Indonesia/English; readers: business owners and senior developers; pillars: rails, ai-engineering, modern full-stack, devtools, open source. Pick the signal with the strongest, most durable angle for that audience.
Reply with ONLY this JSON: {"topic":"short topic","keyword":"primary keyword","angle":"one-line angle","rationale":"why this wins"}
Avoid all of these existing posts: ${corpus.slice(0, 80).map((c) => c.title).join(" | ")}
Signals:
${signals.map((s, i) => `${i + 1}. [${s.source}] ${s.title} — ${s.description.slice(0, 160)} (${s.signals})`).join("\n")}`;
  let topic = AI_STUB ? { topic: "Rails migration testing strategy", keyword: "rails migration testing", angle: "practical guide", rationale: "stub" } : null;
  if (!topic) {
    for (let attempt = 1; attempt <= 3 && !topic; attempt++) {
      try { topic = parseJSONObject(await callCompletion(topicPrompt + (attempt > 1 ? "\n\nPrevious reply invalid; reply with ONLY the JSON object." : ""), { maxTokens: 700 })); }
      catch (e) { console.error(`topic attempt ${attempt}:`, e.message); }
    }
    if (!topic) await fail("topic selection failed after 3 attempts");
  }
  console.log(`topic: ${topic.topic} | keyword: ${topic.keyword} | angle: ${topic.angle}`);

  // 3) article generation — two calls: (A) small JSON metadata, (B) plain-text body
  const existingLinks = corpus.slice(0, 40).map((c) => `/blog/${c.slug} — ${c.title}`).join("\n");
  const existingSlugs = corpusSlugs;
  const metaPrompt = `You choose metadata for one RailsDev.io (railsdev.io) blog article. Topic: ${topic.topic}. Primary keyword: "${topic.keyword}". Angle: ${topic.angle}.
Pick a title, slug (kebab-case, unique), and service. Reply with ONLY this JSON:
{"title":"...","seoTitle":"<= 49 chars","description":"120-160 chars","keyword":"${topic.keyword}","slug":"kebab-case-slug","service":"${SERVICE_VALUES.join("|")}","coverAlt":"what the cover diagram shows"}`;
  const meta = AI_STUB ? stubArticle() : await (async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { const m = parseJSONObject(await callCompletion(metaPrompt + (attempt > 1 ? "\n\nPrevious reply invalid; reply with ONLY the JSON object." : ""), { maxTokens: 700 })); if (m) return m; }
      catch (e) { console.error(`meta attempt ${attempt}:`, e.message); }
    }
    return null;
  })();
  if (!meta) await fail("article metadata generation failed after 3 attempts");
  if (!meta.keyword) meta.keyword = topic.keyword;
  console.log(`meta: ${meta.title} | ${meta.slug}`);
  const bodyPrompt = `Write the body of one RailsDev.io (railsdev.io) blog article in English: first person, senior-Rails-consultant voice — practical, specific, opinionated, honest about uncertainty.
Topic: ${topic.topic}. Keyword: "${meta.keyword}". Angle: ${topic.angle}. Title: ${meta.title}.
Requirements:
- 1800-2400 words. H2/H3 sections only, never a # H1 line.
- At least one fenced ruby or bash code example.
- An explicit blockquote "Verification note" for anything unverified; never invent benchmarks, versions, dates or statistics.
- At most 2 internal links to these existing posts:
${existingLinks}
- Reference ONLY real URLs (official docs and the like). If a fact can't be verified, say so in the verification note rather than asserting it.
Return ONLY the article body as markdown: the opening paragraph and "##" sections. No title, no frontmatter, no preamble, no trailing notes.`;
  const body = AI_STUB ? stubArticle().body : await (async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const text = await callCompletion(bodyPrompt + (attempt > 1 ? "\n\nYour previous attempt failed. Return ONLY the markdown body." : ""), { maxTokens: 8000, expectJSON: false });
        if (text && text.length > 1500) return text.replace(/^```(?:markdown)?\n/, "").replace(/\n```$/, "").trim();
        console.error(`body attempt ${attempt}: too short (${text?.length} chars)`);
      } catch (e) { console.error(`body attempt ${attempt}:`, e.message); }
    }
    return null;
  })();
  if (!body) await fail("article body generation failed after 3 attempts");
  const article = { ...meta, body };
  console.log(`article: ${article.title} | ${article.slug} | seoTitle ${String(article.seoTitle || "").length}c`);

  // 4) validation (with one self-correction retry)
  let v = validateArticle(article, corpusSlugs);
  if (!v.ok) {
    console.error("validation failed, retrying body with feedback:", v.errs.join("; "));
    const retryBody = await (async () => {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const prompt = bodyPrompt + `\n\nYour previous draft failed validation: ${v.errs.join("; ")}. Return a corrected markdown body that fixes these issues. Return ONLY the body.`;
          const text = await callCompletion(prompt, { maxTokens: 8000, expectJSON: false });
          if (text && text.length > 1500) return text.replace(/^```(?:markdown)?\n/, "").replace(/\n```$/, "").trim();
          console.error(`retry body attempt ${attempt}: too short`);
        } catch (e) { console.error(`retry body attempt ${attempt}:`, e.message); }
      }
      return null;
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
  try { makeCover(article.title, coverPath); console.log("cover generated:", coverPath); } catch (e) { await fail(e.message); return; }

  // 6) write .md
  const mdPath = join(SITE_DIR, "src/content/blog", `${article.slug}.md`);
  writeFileSync(mdPath, frontmatter(article));
  console.log("wrote", mdPath);

  // 7) build must pass
  console.log("running astro check && astro build …");
  try { execSync("npm run build", { cwd: SITE_DIR, stdio: "pipe", timeout: 600000, env: { ...process.env } }); }
  catch (e) { const out = String(e.stdout || "") + String(e.stderr || ""); await fail(`site build failed: ${out.slice(-500)}`); return; }
  console.log("build passed");

  // 8) commit + PR (skipped in DRY_RUN)
  if (DRY_RUN) { console.log("=== DRY RUN — would open PR ==="); console.log(`title: content: add ${article.slug}`); console.log(`branch: blog/${article.slug}`); console.log(`description: ${article.description}`); return; }
  if (!RAILSDEV_PAT) await fail("RAILSDEV_PAT not set");
  const git = (args) => execSync(`git ${args}`, { cwd: SITE_DIR, stdio: "pipe", env: { ...process.env, GH_TOKEN: RAILSDEV_PAT } }).toString();
  const branch = `blog/${article.slug}`;
  try { git(`checkout -B ${branch}`); } catch (e) { await fail(`git checkout: ${String(e.message).slice(0, 200)}`); return; }
  git("add src/content/blog src/assets/blog");
  git(`-c user.name="railsdev-bot" -c user.email="bot@railsdev.io" commit -m "content: add ${article.slug}"`);
  git(`push -u origin ${branch}`);
  const prBody = `## Summary\n- Article: **${article.title}** (keyword: ${article.keyword}, ~${v.wordCount} words)\n- Service angle: ${article.service || "(none)"}\n- Generated by the rails-blog-writer pilot pipeline from signals + corpus review; **requires human review before merge**.\n\n## Sources\n- Topic from signals; external links in the article are HEAD-verified.\n\n## Validation\n- [x] astro check && astro build passed\n- [x] description ${article.description.length}c · seoTitle ${article.seoTitle.length}c · keyword in title/desc\n- [x] ${v.links.length} external links HEAD-checked (${dead} dead)\n- [ ] **Human: verify version numbers, code examples run, and the voice matches the site.**\n\nDO NOT MERGE WITHOUT REVIEW.`;
  const pr = execSync(`gh pr create --base main --head ${branch} --title "content: add ${article.slug}" --body "$(cat <<'EOF'\n${prBody}\nEOF\n)"`, { cwd: SITE_DIR, env: { ...process.env, GH_TOKEN: RAILSDEV_PAT }, stdio: "pipe" }).toString().trim();
  console.log("PR opened:", pr);
  await postToSlack([`🖌️ _RailsDev draft PR ready_\n*${article.title}*\n→ ${pr}\n${v.wordCount} words · keyword: ${article.keyword} · needs your review before merge.`]);
})().catch(async (e) => { await fail(`unexpected error: ${String(e).slice(0, 300)}`); });
