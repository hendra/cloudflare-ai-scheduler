#!/usr/bin/env node
// INASOFT — Daily Technology & AI News Digest (→ Slack #news)
//
// Deterministic, zero-dependency Node script. Fetches RSS/Atom signals
// (no LLM browsing), asks the AI chain to pick one candidate per category
// (JSON, with `ref` grounding), composes the digest deterministically,
// and posts to Slack (split into 2 messages if needed).
//
// Env:
//   DRY_RUN=true            Everything except the Slack post (preview)
//   SLACK_BOT_TOKEN         Slack bot token (xoxb-…)
//   SLACK_NEWS_CHANNEL_ID   Channel ID for #news
//   AI_PROVIDER             openrouter|opencode|… (default openrouter)
//   AI_FALLBACKS            comma-separated fallbacks
//   OPENROUTER_API_KEY / OPENCODE_API_KEY
//
// Exit: 0 = delivered (posted or printed), 1 = failure (Slack note attempted).

import { writeFileSync } from "node:fs";
import { callModel, providerChain, PROVIDERS } from "./ai-providers.mjs";
import { safeMrkdwn, slackLink, postSlack, postSlackParts } from "./slack.mjs";

const DRY_RUN = String(process.env.DRY_RUN || "false") === "true";
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const SLACK_NEWS_CHANNEL_ID = process.env.SLACK_NEWS_CHANNEL_ID || "";
const wib = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const decodeEntities = (s) => String(s).replace(/&#(x[0-9a-fA-F]+|\d+);/g, (m, n) => {
  const cp = n[0] === "x" ? parseInt(n.slice(1), 16) : parseInt(n, 10);
  return cp ? String.fromCodePoint(cp) : m;
});
const strip = (s) => decodeEntities(String(s || "")).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
// Slack mrkdwn escaping for AI/scraped prose lives in ./slack.mjs (escapes &,<,>).

async function fetchText(url, { timeout = 30000, ua = "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0" } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { "User-Agent": ua }, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  } finally { clearTimeout(t); }
}

function parseRss(xml, max = 10) {
  const items = [];
  const itemMatches = (xml.match(/<item[\s\S]*?<\/item>/g) || []);
  for (const raw of itemMatches.slice(0, max)) {
    const titleM = raw.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const linkM = raw.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || raw.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
    const dateM = raw.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || raw.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i);
    const descM = raw.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i) || raw.match(/<content:encoded[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content:encoded>/i);
    const title = strip(titleM ? titleM[1] : "");
    const link = strip(linkM ? linkM[1] : "");
    const date = strip(dateM ? dateM[1] : "");
    const summary = strip(descM ? descM[1] : "").slice(0, 280);
    if (title && link) items.push({ source: "", title, url: link, date, summary });
  }
  return items;
}

function parseAtom(xml, max = 10) {
  const items = [];
  const entryMatches = (xml.match(/<entry[\s\S]*?<\/entry>/g) || []);
  for (const raw of entryMatches.slice(0, max)) {
    const titleM = raw.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const linkM = raw.match(/<link[^>]*href="([^"]+)"/i);
    const dateM = raw.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i) || raw.match(/<published[^>]*>([\s\S]*?)<\/published>/i);
    const summaryM = raw.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/i) || raw.match(/<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/i);
    const title = strip(titleM ? titleM[1] : "");
    const link = strip(linkM ? linkM[1] : "");
    const date = strip(dateM ? dateM[1] : "");
    const summary = strip(summaryM ? summaryM[1] : "").slice(0, 280);
    if (title && link) items.push({ source: "", title, url: link, date, summary });
  }
  return items;
}

async function fetchFeed(url, sourceName, max = 10) {
  try {
    const xml = await fetchText(url);
    const items = /<entry/i.test(xml) ? parseAtom(xml, max) : parseRss(xml, max);
    for (const item of items) item.source = sourceName;
    return items;
  } catch (e) {
    console.error(`source ${sourceName} failed: ${String(e).slice(0, 160)}`);
    return [];
  }
}

const SOURCES = [
  ["openai", "https://openai.com/news/rss.xml"],
  ["huggingface", "https://huggingface.co/blog/feed.xml"],
  ["github-blog", "https://github.blog/feed/"],
  ["nodejs-blog", "https://nodejs.org/feed"],
  ["python-blog", "https://blog.python.org/rss.xml"],
  ["nextjs-blog", "https://nextjs.org/feed.xml"],
  ["react-dev", "https://react.dev/feed.xml"],
  ["techcrunch", "https://techcrunch.com/feed/"],
  ["theverge", "https://www.theverge.com/rss/index.xml"],
  ["arstechnica", "https://feeds.arstechnica.com/arstechnica/index"],
];

const CATEGORIES = [
  { key: "AI", label: "ARTIFICIAL INTELLIGENCE", emoji: "🤖" },
  { key: "AI ENGINEERING", label: "AI ENGINEERING", emoji: "🛠️" },
  { key: "SOFTWARE DEVELOPMENT", label: "SOFTWARE DEVELOPMENT", emoji: "💻" },
  { key: "TECHNOLOGY", label: "TECHNOLOGY", emoji: "🌐" },
];

// Async + awaited at every call site: execution must stop here, never continue past a failure
// (previously the script kept running while the Slack note was in flight).
async function fail(reason) {
  console.error("FATAL:", reason);
  const note = `⚠️ _INASOFT DAILY TECH & AI NEWS DIGEST_ could not be produced. ${String(reason).slice(0, 300)}`;
  if (DRY_RUN) { console.error("dry run — not posting failure note to Slack"); process.exit(1); }
  if (!SLACK_BOT_TOKEN || !SLACK_NEWS_CHANNEL_ID) process.exit(1);
  // failure-posted only when Slack actually accepted the note (workflow contract).
  const r = await postSlack({ token: SLACK_BOT_TOKEN, channel: SLACK_NEWS_CHANNEL_ID, text: note });
  if (r.ok) { try { writeFileSync("failure-posted", "1"); } catch {} } else console.error("failure note rejected by Slack:", r.error);
  process.exit(1);
}

async function main() {
  // 0) preflight — mirror the trending script's clarity
  const chain = providerChain();
  const usable = chain.filter((n) => PROVIDERS[n] && PROVIDERS[n].key());
  console.log(`ai: provider chain ${chain.join(" -> ")} (usable: ${usable.join(", ") || "none"})`);
  if (usable.length === 0) await fail("no AI provider has credentials");

  // 1) collect signals
  const all = [];
  for (const [name, url] of SOURCES) {
    const items = await fetchFeed(url, name, 4);
    all.push(...items);
  }
  console.log(`signals collected: ${all.length} items from ${SOURCES.length} sources`);
  if (all.length < 4) await fail("too few items from sources; refusing to fabricate");

  // 2) ask AI to SELECT with grounded refs — composition is deterministic afterwards
  const lines = all.map((s, i) => `${i + 1}. [${s.source}] ${s.title} | ${s.url} | ${s.date || "(date unknown)"} | ${s.summary.slice(0, 140)}`).join("\n");
  const prompt = `You are a technology news editor for INASOFT. From the candidate stories below (numbered 1..N), select exactly ONE story per category. Pick candidates of different categories without repeating a ref twice. Facts and figures must come ONLY from the chosen candidate's fields — do not add external knowledge, numbers, dates, or URLs.

Output ONLY this JSON (no prose, no fences):
{"stories":[{"category":"AI"|"AI ENGINEERING"|"SOFTWARE DEVELOPMENT"|"TECHNOLOGY","ref":<1..N>,"summary":"3–5 sentences: what happened, who announced it, key facts present in the candidate","why":"1–2 sentences on impact"}],"insight":"2–4 sentences: dominant trend across the four stories, and one actionable consideration for INASOFT"}

Candidates:
${lines}`;

  console.log("asking AI…");
  // The preset occasionally emits malformed JSON (e.g. `"category="X"`), so retry before giving up.
  let parsed, lastErr;
  for (let attempt = 1; attempt <= 3 && !parsed; attempt++) {
    try {
      const raw = await callModel(prompt + (attempt > 1 ? "\n\nYour previous reply was not valid JSON. Reply with ONLY the JSON object." : ""), { maxTokens: 3000, expectJSON: true, temperature: 0.4 });
      const m = raw.match(/\{[\s\S]*\}/);
      const j = JSON.parse(m ? m[0] : raw);
      if (!Array.isArray(j?.stories) || j.stories.length !== 4) throw new Error(`expected 4 stories, got ${Array.isArray(j?.stories) ? j.stories.length : "none"}`);
      parsed = j;
    } catch (e) { lastErr = e; console.error(`AI selection attempt ${attempt} failed: ${String(e).slice(0, 160)}`); }
  }
  if (!parsed) await fail(`AI selection failed after 3 attempts: ${String(lastErr).slice(0, 220)}`);

  // 3) ground + validate
  const stories = parsed.stories || [];
  if (stories.length !== 4) await fail(`AI returned ${stories.length} stories (need exactly 4)`);
  const seenRefs = new Set();
  const byCat = new Map(CATEGORIES.map(c => [c.key, null]));
  for (const s of stories) {
    const idx = parseInt(s.ref, 10) - 1;
    const cand = all[idx];
    if (cand === undefined) await fail(`AI returned invalid ref ${s.ref}`);
    if (seenRefs.has(idx)) await fail(`AI repeated ref ${s.ref} across categories`);
    seenRefs.add(idx);
    const cat = byCat.get(s.category);
    if (cat) await fail(`duplicate category ${s.category}`);
    const c = CATEGORIES.find(c => c.key === s.category);
    if (!c) await fail(`unknown category ${s.category}`);
    byCat.set(c.key, { ...s, headline: cand.title, url: cand.url, date: cand.date, source: cand.source });
  }
  const ordered = CATEGORIES.map(c => byCat.get(c.key));
  const insight = safeMrkdwn(parsed.insight || "").trim();
  if (!insight) await fail("AI returned an empty insight");

  // 4) compose mrkdwn deterministically
  const header = `🚀 _INASOFT DAILY TECH & AI NEWS DIGEST_\n📅 _Date:_ ${wib} (Asia/Jakarta)\n🌍 _Coverage:_ Latest trending developments in AI, AI Engineering, Software Development & Technology.\n\n`;
  const body = ordered.map((s, i) => {
    const c = CATEGORIES[i];
    return `━━━━━━━━━━━━━━━━━━━━\n\n${c.emoji} _${i + 1}. ${c.label}_\n_📰 ${safeMrkdwn(s.headline)}_\n${safeMrkdwn(s.summary)}\n\n💡 _Why It Matters:_\n${safeMrkdwn(s.why)}\n\n🔗 _Source:_ ${slackLink(s.url, s.source)} · ${safeMrkdwn(s.date || "date unavailable")}\n`;
  });
  const tail = `\n━━━━━━━━━━━━━━━━━━━━\n\n🎯 _INASOFT INSIGHT OF THE DAY_\n${insight}\n\n━━━━━━━━━━━━━━━━━━━━\n\n🤖 _Powered by AI | Curated for the INASOFT Engineering Team_`;

  const full = header + body.join("\n") + tail;
  const SLACK_LIMIT = 3500;
  const parts = full.length <= SLACK_LIMIT ? [full] : [
    [header, ...body.slice(0, 2)].join("\n"),
    [...body.slice(2), tail].join("\n"),
  ];

  if (DRY_RUN) {
    console.log("=== DRY RUN — message(s) that would be posted to #news ===");
    parts.forEach((p, i) => console.log(`--- part ${i + 1} (${p.length} chars) ---\n${p}\n`));
    process.exit(0);
  }

  // 5) post to Slack
  if (!SLACK_BOT_TOKEN || !SLACK_NEWS_CHANNEL_ID) {
    console.error("SLACK_BOT_TOKEN and SLACK_NEWS_CHANNEL_ID required to post");
    process.exit(1);
  }
  const r = await postSlackParts({ token: SLACK_BOT_TOKEN, channel: SLACK_NEWS_CHANNEL_ID, parts });
  if (!r.ok) {
    console.error(`Slack post failed: ${r.error} (${r.posted} of ${parts.length} part(s) accepted)`);
    if (r.posted > 0) {
      // Channel already saw a partial digest — make the gap explicit in-channel.
      const note = `⚠️ _INASOFT DAILY TECH & AI NEWS DIGEST_ posting failed after part ${r.posted} of ${parts.length} — the digest above is incomplete. ${r.error}`.slice(0, 500);
      const nr = await postSlack({ token: SLACK_BOT_TOKEN, channel: SLACK_NEWS_CHANNEL_ID, text: note });
      if (nr.ok) { try { writeFileSync("failure-posted", "1"); } catch {} }
      process.exit(1);
    }
    await fail(`Slack post failed: ${r.error}`);
    return;
  }
  console.log(`posted (${r.posted} part(s)) to #news`);
}

main().catch(async (e) => { await fail(`unexpected error: ${String(e?.message || e).slice(0, 300)}`); });
