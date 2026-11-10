#!/usr/bin/env node
// INASOFT — Daily Technology & AI News Digest (→ Slack #news)
//
// Deterministic, zero-dependency Node script. Fetches RSS/Atom/HN signals
// (no LLM browsing), asks the AI chain to pick exactly one high-quality
// story per fixed category, writes the digest, and posts it to Slack.
//
// Env:
//   DRY_RUN=true            Everything except the Slack post (preview)
//   SLACK_BOT_TOKEN         Slack bot token (xoxb-…)
//   SLACK_NEWS_CHANNEL_ID   Channel ID for #news
//   AI_PROVIDER             openrouter|groq|cloudflare|… (default openrouter)
//   AI_FALLBACKS            comma-separated fallbacks (default openrouter,groq,cloudflare)
//   AI_MODEL / GROQ_MODEL   model overrides
//   OPENROUTER_API_KEY / GROQ_API_KEY / CF_*
//
// Exit: 0 = digest posted (or printed in dry run), 1 = failure (Slack note attempted).

import { writeFileSync } from "node:fs";
import { callModel } from "./ai-providers.mjs";

const DRY_RUN = String(process.env.DRY_RUN || "false") === "true";
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const SLACK_NEWS_CHANNEL_ID = process.env.SLACK_NEWS_CHANNEL_ID || "";
const wib = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

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
  // AI and AI engineering
  ["openai", "https://openai.com/news/rss.xml"],
  ["huggingface", "https://huggingface.co/blog/feed.xml"],
  // Software development
  ["github-blog", "https://github.blog/feed/"],
  ["nodejs-blog", "https://nodejs.org/feed"],
  ["python-blog", "https://blog.python.org/rss.xml"],
  ["nextjs-blog", "https://nextjs.org/feed.xml"],
  ["react-dev", "https://react.dev/feed.xml"],
  // Broader tech industry
  ["techcrunch", "https://techcrunch.com/feed/"],
  ["theverge", "https://www.theverge.com/rss/index.xml"],
  ["arstechnica", "https://feeds.arstechnica.com/arstechnica/index"],
];

const CATEGORIES = [
  { key: "ai", label: "ARTIFICIAL INTELLIGENCE", emoji: "🤖" },
  { key: "ai_engineering", label: "AI ENGINEERING", emoji: "🛠️" },
  { key: "software_development", label: "SOFTWARE DEVELOPMENT", emoji: "💻" },
  { key: "technology", label: "TECHNOLOGY", emoji: "🌐" },
];

async function main() {
  // 1) collect signals
  const all = [];
  for (const [name, url] of SOURCES) {
    const items = await fetchFeed(url, name, 4);
    all.push(...items);
  }
  console.log(`signals collected: ${all.length} items from ${SOURCES.length} sources`);
  if (all.length < 4) {
    console.error("too few items from sources; refusing to fabricate");
    process.exit(1);
  }

  // 2) ask AI to select + write digest
  const lines = all.map((s, i) => `${i + 1}. [${s.source}] ${s.title} | ${s.url} | ${s.date || "(date unknown)"} | ${s.summary.slice(0, 140)}`).join("\n");
  const prompt = `You are a professional technology news editor for INASOFT. From the candidate stories below, select exactly ONE story per required category. Do NOT invent facts, quotes, dates, URLs, or numbers — only use facts explicitly present in the candidates.

Write the digest in English using Slack mrkdwn, with this exact structure (keep the dashed separator lines):

🚀 _INASOFT DAILY TECH & AI NEWS DIGEST_
📅 _Date:_ ${wib} (Asia/Jakarta)
🌍 _Coverage:_ Latest trending developments in AI, AI Engineering, Software Development & Technology.

━━━━━━━━━━━━━━━━━━━━

🤖 _1. ARTIFICIAL INTELLIGENCE_
_📰 <headline>_
<3–5 sentences summarizing what happened, who announced it, key facts>

💡 _Why It Matters:_
<1–2 sentences on impact>

🔗 _Source:_ <<url|Read Full Article>>

━━━━━━━━━━━━━━━━━━━━

🛠️ _2. AI ENGINEERING_
... same slots ...

━━━━━━━━━━━━━━━━━━━━

💻 _3. SOFTWARE DEVELOPMENT_
... same slots ...

━━━━━━━━━━━━━━━━━━━━

🌐 _4. TECHNOLOGY_
... same slots ...

━━━━━━━━━━━━━━━━━━━━

🎯 _INASOFT INSIGHT OF THE DAY_
<2–4 sentences: what is the dominant trend across the four stories, and one actionable consideration for INASOFT>

━━━━━━━━━━━━━━━━━━━━

🤖 _Powered by AI | Curated for the INASOFT Engineering Team_

Rules:
- You MUST pick stories from the candidates below. Do not cite any story not listed.
- Include the publication date for every story you pick.
- Categories may not repeat the same story.
- URLs must match the candidate's URL exactly.

Candidates:
${lines}

Return ONLY the formatted digest — no JSON, no code fences, no commentary.`;

  if (DRY_RUN) {
    console.log("=== DRY RUN — would post to #news ===");
    console.log("=== candidates ready ===\n" + lines);
  }

  console.log("asking AI…");
  const digest = await callModel(prompt, { maxTokens: 4096, expectJSON: false, temperature: 0.4 });

  if (DRY_RUN) {
    console.log("--- digest ---\n" + digest);
    process.exit(0);
  }

  // 3) post to Slack
  if (!SLACK_BOT_TOKEN || !SLACK_NEWS_CHANNEL_ID) {
    console.error("SLACK_BOT_TOKEN and SLACK_NEWS_CHANNEL_ID required to post");
    process.exit(1);
  }
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: SLACK_NEWS_CHANNEL_ID, text: digest }),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) {
    console.error("Slack post failed:", body.error || res.status);
    process.exit(1);
  }
  console.log(`posted to #news (channel ${body.channel}, ts ${body.ts})`);
}

main().catch((e) => {
  console.error("FATAL:", e?.message || e);
  process.exit(1);
});
