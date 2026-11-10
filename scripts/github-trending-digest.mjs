#!/usr/bin/env node
import { PROVIDERS, providerChain, callModel } from "./ai-providers.mjs";
// GitHub Trending — Daily/Weekly Top 10 → Slack #news (deterministic, zero dependencies)
//
// WEEKLY=true fetches github.com/trending?since=weekly and labels the digest
// "Top 10 of the Week" (coverage: previous Monday–Sunday, Asia/Jakarta).
//
// Flow: fetch the trending page (regex parse, browser UA)
//   → fallback: GitHub search API via `gh` (labelled "fallback: newly created
//     repos by stars") → for each repo fetch README (best-effort, 4 KB cap)
//     and, in weekly mode only, license + latest release via `gh api` (best-effort)
//   → ONE Workers AI completion (OpenAI-compatible chat endpoint, plain string
//     content — Workers AI rejects array/null content) → compose mrkdwn
//   → print (DRY_RUN) or post to Slack #news via chat.postMessage
//
// Env: DRY_RUN=true|false; AI_PROVIDER (default cloudflare); AI_FALLBACKS
//      (default "groq,gemini,cerebras,openrouter,mistral", comma-separated,
//      providers without credentials are skipped); AI_MODEL (overrides primary);
//      <PROVIDER>_MODEL per provider (CLOUDFLARE_MODEL, GROQ_MODEL,
//      CEREBRAS_MODEL, GEMINI_MODEL, OPENROUTER_MODEL, MISTRAL_MODEL).
// Credentials: CF_ACCOUNT_ID + CF_API_TOKEN (cloudflare), GROQ_API_KEY, CEREBRAS_API_KEY, GEMINI_API_KEY,
//      OPENROUTER_API_KEY, MISTRAL_API_KEY. SLACK_BOT_TOKEN, SLACK_NEWS_CHANNEL_ID,
//      GH_TOKEN (fallback + gh).
//      AI_STUB=true  -> skip all AI calls and synthesize the analysis locally
//      (offline testing / dry runs when the free daily Neuron allocation is
//      exhausted). Never posts anything new; only exists to exercise the pipeline.
// Exit: 0 = digest (or failure note) posted or fully handled; 1 = unhandled error
//       (workflow failure step posts a generic ⚠️ only if we didn't post one).

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const DRY_RUN = String(process.env.DRY_RUN || "false") === "true";
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "";
const CF_API_TOKEN = process.env.CF_API_TOKEN || "";
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const SLACK_NEWS_CHANNEL_ID = process.env.SLACK_NEWS_CHANNEL_ID || "";
const AI_MODEL = process.env.AI_MODEL || ""; // overrides the primary provider's model
// Provider chain: AI_PROVIDER (default cloudflare) then AI_FALLBACKS in order;
// providers without credentials are skipped. Per-provider model overrides:
// Provider model overrides: CLOUDFLARE_MODEL, GROQ_MODEL, CEREBRAS_MODEL,
// GEMINI_MODEL, OPENROUTER_MODEL, MISTRAL_MODEL.
const CATEGORIES = ["AI/LLM","Agents/MCP","Dev Tools","Web/Frontend","Backend","Infra/DevOps","Data","Security","Other"];
// Weekly mode (WEEKLY=true): fetches github.com/trending?since=weekly, labels the
// digest "Top 10 of the Week", and uses the previous Monday–Sunday window in Asia/Jakarta.
const WEEKLY = String(process.env.WEEKLY || "false") === "true";
const now = new Date();
const wibISO = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year:"numeric", month:"2-digit", day:"2-digit" }).format(now);
const WD = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
// Anchor all week math to the Jakarta calendar day, not the container's local day
const [jy, jm, jd] = wibISO.split("-").map(Number);
const jakartaTodayUTC = Date.UTC(jy, jm - 1, jd); // the Jakarta calendar date as a UTC midnight
const jakartaDow = WD[new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Asia/Jakarta" }).format(now)];
const weekStart = new Date(jakartaTodayUTC - (jakartaDow - 1 + 7) * 86400000);
const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
const wibDateStart = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year:"numeric", month:"2-digit", day:"2-digit" }).format(weekStart);
const wibDateEnd   = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year:"numeric", month:"2-digit", day:"2-digit" }).format(weekEnd);
const gainedLabel = WEEKLY ? "this week" : "today";
const digestTitle = WEEKLY ? "Top 10 of the Week" : "Top 10 Today";
const trendTitle = WEEKLY ? "Trends of the Week" : "Trend of the Day";
const footerKind = WEEKLY ? "weekly" : "daily";
const headerLink = WEEKLY
  ? "<https://github.com/trending?since=weekly|github.com/trending (weekly)>"
  : "<https://github.com/trending?since=daily|github.com/trending>";
const repoMetaLine = (r) => {
  if (!r.license && !r.release) return "";
  return `\n📄 ${r.license || "license not shown"}${r.release ? ` · 🏷️ ${r.release.tag} (${r.release.date || "date unknown"})` : ""}`;
};

const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const num = (s) => parseInt(String(s).replace(/[^\d]/g, ""), 10) || 0;

function fail(msg) {
  console.error("FATAL:", msg);
  const note = `⚠️ _GitHub Trending — ${digestTitle}_ could not be produced. ${msg}`.slice(0, 500);
  if (DRY_RUN) { console.error("dry run — not posting failure note to Slack"); process.exit(1); }
  return postToSlack([note], true).then(() => {
    try { writeFileSync("failure-posted", "1"); } catch {}
    process.exit(1);
  }).catch(() => process.exit(1));
}

async function fetchText(url, { ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36", headers = {}, timeout = 30000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { "User-Agent": ua, "Accept": "text/html,application/json,text/plain,*/*", ...headers }, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return { text: await res.text(), url: res.url };
  } finally { clearTimeout(t); }
}

// ---------- 1. collect ----------
async function collect() {
  const { text: html } = await fetchText(WEEKLY ? "https://github.com/trending?since=weekly" : "https://github.com/trending?since=daily");
  const blocks = html.match(/<article class="Box-row">[\s\S]*?<\/article>/g) || [];
  const repos = [];
  for (const block of blocks) {
    const hrefM = block.match(/<h2[^>]*>[\s\S]*?href="(\/[^"]+)"/);
    if (!hrefM) continue;
    const full = hrefM[1].slice(1);
    const [owner, name] = full.split("/");
    if (!owner || !name) continue;
    const descM = block.match(/<p class="col-9[^>]*>([\s\S]*?)<\/p>/);
    const langM = block.match(/itemprop="programmingLanguage">([^<]+)</);
    const starsM = block.match(/href="\/[^"]+\/stargazers"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)\s*<\/a>/);
    const todayM = block.match(/([\d,]+)\s+stars?\s+(?:today|this week)/);
    const forksM = block.match(/href="\/[^"]+\/forks"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)\s*<\/a>/);
    repos.push({
      owner, name,
      url: `https://github.com/${owner}/${name}`,
      description: descM ? strip(descM[1]) : "",
      language: langM ? langM[1].trim() : "unknown",
      stars: starsM ? num(starsM[1]) : null,
      today: todayM ? num(todayM[1]) : null,
      forks: forksM ? num(forksM[1]) : null,
    });
  }
  if (repos.length < 10) {
    console.warn(`trending parse yielded only ${repos.length} repos; falling back to search API`);
    return collectFallback();
  }
  return { repos: repos.slice(0, 10), fallback: false };
}

async function collectFallback() {
  const fallbackStart = WEEKLY ? weekStart : new Date(Date.now() - 86400000);
  const since = fallbackStart.toISOString().slice(0, 10);
  const created = WEEKLY
    ? `created:${since}..${weekEnd.toISOString().slice(0, 10)}`
    : `created:>=${since}`;
  try {
    const out = execSync(
      `gh api "search/repositories?q=${created}&sort=stars&order=desc&per_page=10" --jq '.items[] | [.full_name, (.description // ""), (.stargazers_count|tostring), (.forks_count|tostring), (.language // "unknown")] | @tsv'`,
      { encoding: "utf8", timeout: 60000 }
    );
    const repos = out.trim().split("\n").filter(Boolean).map((line) => {
      const [full, description, stars, forks, language] = line.split("\t");
      const [owner, name] = full.split("/");
      return { owner, name, url: `https://github.com/${owner}/${name}`, description, language, stars: num(stars), today: null, forks: num(forks) };
    });
    if (repos.length === 0) throw new Error("search API returned no items");
    return { repos, fallback: true };
  } catch (e) {
    throw new Error(`both trending page parse and search API fallback failed: ${String(e).slice(0, 200)}`);
  }
}

// ---------- 2b. weekly-only per-repo license + latest release (best-effort, when visible) ----------
function enrichRepoApi(r) {
  if (!WEEKLY) return;
  try {
    const lic = execSync(`gh api repos/${r.owner}/${r.name} --jq '.license.spdx_id // ""'`, { encoding: "utf8", timeout: 30000 }).trim();
    r.license = lic && lic !== "NOASSERTION" ? lic : null;
  } catch { r.license = null; }
  try {
    const rel = execSync(`gh api repos/${r.owner}/${r.name}/releases/latest --jq '[.tag_name // "", .published_at // ""] | @tsv'`, { encoding: "utf8", timeout: 30000 }).trim();
    const [tag, published] = rel.split("\t");
    r.release = tag ? { tag, date: (published || "").slice(0, 10) } : null;
  } catch { r.release = null; }
}

async function fetchReadme(owner, name) {
  for (const path of ["README.md", "README.MD", "Readme.md", "readme.md", "README"]) {
    try {
      const { text } = await fetchText(`https://raw.githubusercontent.com/${owner}/${name}/HEAD/${path}`, { ua: "curl", timeout: 15000 });
      return text.slice(0, 4000);
    } catch { /* try next */ }
  }
  return "";
}

// ---------- 2. AI analysis (single completion, string content) ----------
async function analyze(repos) {
  if (process.env.AI_STUB === "true") {
    return { repos: repos.map((r) => ({ ...r, what: r.description || "No description provided.", why: "Notable on the weekly trending list.", category: "Other" })), trend: "Stubbed analysis (AI_STUB=true) — pattern detection omitted." };
  }
  const lines = repos.map((r, i) =>
    `${i + 1}. ${r.owner}/${r.name} | lang=${r.language} | stars=${r.stars ?? "n/a"} | today=${r.today ?? "n/a"} | forks=${r.forks ?? "n/a"}\n   desc: ${r.description || "(none)"}\n   readme excerpt: ${(r.readme || "(unavailable)").slice(0, 600)}`
  ).join("\n");
  const prompt = `You are writing a developer newsletter blurb. For each of the 10 repositories below write:
- "what": what it is, 1-2 plain sentences (no hype).
- "why": why it matters for developers, exactly 1 sentence, grounded in the README excerpt or description — no speculation presented as fact.
- "category": exactly one of ${CATEGORIES.join(", ")}.
Then write "trend": 2-3 sentences noting patterns across the 10 (dominant language/category).
Reply with ONLY a JSON object, no prose: {"repos":[{"name":"owner/name","what":"...","why":"...","category":"..."}], "trend":"..."} — repos array must be in the same order as the input, exactly 10 items.
Repositories:
${lines}`;
  let parsed = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await callModel(prompt + (attempt > 1 ? "\n\nYour previous reply was not valid JSON. Reply with ONLY the JSON object." : ""));
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) { console.error(`ai: attempt ${attempt}: no JSON object found`); continue; }
    try { parsed = JSON.parse(m[0]); break; } catch (e) { console.error(`ai: attempt ${attempt}: JSON parse failed: ${e.message}`); }
  }
  if (!parsed) throw new Error("AI returned invalid JSON twice");
  const byName = new Map((parsed.repos || []).map((r) => [r.name, r]));
  const enriched = repos.map((r) => {
    const a = byName.get(`${r.owner}/${r.name}`) || {};
    const category = CATEGORIES.includes(a.category) ? a.category : "Other";
    return { ...r, what: (a.what || r.description || "No description provided.").trim(), why: (a.why || "Notable on the trending list.").trim(), category };
  });
  return { repos: enriched, trend: (parsed.trend || "").trim() || "Various developer tools trending across the ecosystem today." };
}

// ---------- 3. message + post ----------
function compose({ repos, fallback, trend }) {
  const dateLine = WEEKLY
    ? `📅 _Week:_ ${wibDateStart} – ${wibDateEnd} (Asia/Jakarta)`
    : `📅 _Date:_ ${wibISO} (Asia/Jakarta)`;
  const header = fallback
    ? `⚠️ _GitHub Trending — ${digestTitle} (fallback: newly created repos by stars)_\n${dateLine} | 🔗 ${headerLink}\n`
    : `${WEEKLY ? "📊" : "🔥"} _GitHub Trending — ${digestTitle}_\n${dateLine} | 🔗 ${headerLink}\n`;
  const sections = repos.map((r, i) => {
    const stars = r.stars != null ? `⭐ ${r.stars.toLocaleString()}${r.today != null ? ` (+${r.today.toLocaleString()} ${gainedLabel})` : ""}` : "⭐ n/a";
    const forks = r.forks != null ? `🍴 ${r.forks.toLocaleString()}` : "🍴 n/a";
    return `━━━━━━━━━━━━━━━━━━━━\n_${i + 1}. <${r.url}|${r.owner}/${r.name}>_ · \`${r.language}\` · ${r.category}\n${stars} · ${forks}${repoMetaLine(r)}\n${r.what}\n💡 ${r.why}`;
  });
  const tail = `━━━━━━━━━━━━━━━━━━━━\n📈 _${trendTitle}_\n${trend}\n\n🤖 _Automated ${footerKind} GitHub trending digest_`;
  return { header, full: [header, sections.join("\n\n"), tail].join("\n\n") };
}

async function postToSlack(messages, isFailureNote = false) {
  for (const text of messages) {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: SLACK_NEWS_CHANNEL_ID, text }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) throw new Error(`Slack post failed: ${body.error || res.status}`);
  }
  console.log(`Slack post${isFailureNote ? " (failure note)" : ""}: ok (${messages.length} message(s))`);
}

// ---------- main ----------
(async () => {
  if (!DRY_RUN && (!SLACK_BOT_TOKEN || !SLACK_NEWS_CHANNEL_ID)) { console.error("FATAL: SLACK_BOT_TOKEN and SLACK_NEWS_CHANNEL_ID required (or set DRY_RUN=true)"); process.exit(1); }
  const usable = providerChain().filter((n) => PROVIDERS[n] && PROVIDERS[n].key());
  if (usable.length === 0 && process.env.AI_STUB !== "true") { console.error("FATAL: no AI provider in the chain has credentials (set CF_API_TOKEN or e.g. GITHUB_MODELS_TOKEN/GROQ_API_KEY/GEMINI_API_KEY and adjust AI_PROVIDER/AI_FALLBACKS)"); process.exit(1); }
  console.log(`ai: provider chain ${providerChain().join(" -> ")} (usable: ${usable.join(", ") || "none, using AI_STUB/none"})`);
  let collected;
  try { collected = await collect(); } catch (e) { await fail(`data collection failed: ${e.message}`); return; }
  const { repos, fallback } = collected;
  for (const r of repos) { r.readme = await fetchReadme(r.owner, r.name).catch(() => ""); enrichRepoApi(r); }
  let analysis;
  try { analysis = await analyze(repos); } catch (e) { console.error("AI analysis failed:", e.message); await fail(`AI analysis failed: ${e.message}`); return; }
  const { header, full } = compose({ repos: analysis.repos, fallback, trend: analysis.trend });
  const SLACK_LIMIT = 3500;
  const parts = full.length <= SLACK_LIMIT ? [full] : [
    [header, analysis.repos.slice(0, 5).map((r, i) => `_${i + 1}. <${r.url}|${r.owner}/${r.name}>_ · \`${r.language}\` · ${r.category}\n⭐ ${r.stars?.toLocaleString?.() ?? "n/a"}${r.today != null ? ` (+${r.today.toLocaleString()} ${gainedLabel})` : ""} · 🍴 ${r.forks?.toLocaleString?.() ?? "n/a"}${repoMetaLine(r)}\n${r.what}\n💡 ${r.why}`).join("\n\n")].join("\n\n"),
    [analysis.repos.slice(5).map((r, i) => `_${i + 6}. <${r.url}|${r.owner}/${r.name}>_ · \`${r.language}\` · ${r.category}\n⭐ ${r.stars?.toLocaleString?.() ?? "n/a"}${r.today != null ? ` (+${r.today.toLocaleString()} ${gainedLabel})` : ""} · 🍴 ${r.forks?.toLocaleString?.() ?? "n/a"}${repoMetaLine(r)}\n${r.what}\n💡 ${r.why}`).join("\n\n"), `━━━━━━━━━━━━━━━━━━━━\n📈 _${trendTitle}_\n` + analysis.trend + `\n\n🤖 _Automated ${footerKind} GitHub trending digest_`].join("\n\n"),
  ];
  if (DRY_RUN) {
    console.log("=== DRY RUN — message(s) that would be posted to #news ===");
    parts.forEach((p, i) => console.log(`--- part ${i + 1} (${p.length} chars) ---\n${p}\n`));
    console.log("=== end dry run; source used:", fallback ? "search API (fallback)" : "github.com/trending", "| repos:", analysis.repos.length, "===");
    process.exit(0);
  }
  await postToSlack(parts);
  console.log(JSON.stringify({ event: WEEKLY ? "github-trending-weekly-posted" : "github-trending-posted", date: WEEKLY ? `${wibDateStart}–${wibDateEnd}` : wibISO, repos: analysis.repos.length, fallback, parts: parts.length }));
})().catch((e) => fail(`unexpected error: ${String(e).slice(0, 300)}`));
