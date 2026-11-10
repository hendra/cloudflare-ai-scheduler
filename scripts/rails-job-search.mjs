#!/usr/bin/env node
// Rails — Remote Job Search → Slack #jobs (deterministic, zero dependencies)
//
// Flow: fetch Remotive API + Remote OK API + HN "Who is hiring?" thread
//   (We Work Remotely is Cloudflare-gated — skipped, disclosed in footer)
//   → normalize/dedupe/freshness filter (≤30 days) → one AI completion scores
//   each candidate 0–100 against the hardcoded profile → compose mrkdwn →
//   print (DRY_RUN) or post to Slack #jobs via chat.postMessage.
//
// Env: DRY_RUN=true|false; AI_STUB=true (offline testing); AI_PROVIDER
//   (default cloudflare); AI_FALLBACKS (default groq,gemini,cerebras,openrouter,
//   mistral); AI_MODEL; <PROVIDER>_MODEL. SLACK_BOT_TOKEN, SLACK_JOBS_CHANNEL_ID,
//   GH_TOKEN, CF_ACCOUNT_ID, CF_API_TOKEN, GROQ_API_KEY, …
// Exit: 0 = digest (or failure note) posted/printed; 1 = failure (a ⚠️ note is
//   posted when possible). NEVER posts a digest with invented jobs.

import { writeFileSync } from "node:fs";

const DRY_RUN = String(process.env.DRY_RUN || "false") === "true";
const AI_STUB = process.env.AI_STUB === "true";
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "";
const CF_API_TOKEN = process.env.CF_API_TOKEN || "";
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const SLACK_JOBS_CHANNEL_ID = process.env.SLACK_JOBS_CHANNEL_ID || "";
const AI_PROVIDER = (process.env.AI_PROVIDER || "groq").toLowerCase();
const AI_MODEL = process.env.AI_MODEL || "";

const PROVIDERS = {
  cloudflare: { name: "cloudflare", baseURL: () => `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/v1`, key: () => CF_API_TOKEN, model: () => process.env.CLOUDFLARE_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", jsonMode: true },
  groq:       { name: "groq",       baseURL: () => "https://api.groq.com/openai/v1", key: () => process.env.GROQ_API_KEY || "", model: () => process.env.GROQ_MODEL || "openai/gpt-oss-20b", jsonMode: true },
  cerebras:   { name: "cerebras",   baseURL: () => "https://api.cerebras.ai/v1", key: () => process.env.CEREBRAS_API_KEY || "", model: () => process.env.CEREBRAS_MODEL || "llama-3.3-70b", jsonMode: true },
  gemini:     { name: "gemini",     baseURL: () => "https://generativelanguage.googleapis.com/v1beta/openai", key: () => process.env.GEMINI_API_KEY || "", model: () => process.env.GEMINI_MODEL || "gemini-2.5-flash", jsonMode: true },
  openrouter: { name: "openrouter", baseURL: () => "https://openrouter.ai/api/v1", key: () => process.env.OPENROUTER_API_KEY || "", model: () => process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free" },
  mistral:    { name: "mistral",    baseURL: () => "https://api.mistral.ai/v1", key: () => process.env.MISTRAL_API_KEY || "", model: () => process.env.MISTRAL_MODEL || "mistral-small-latest", jsonMode: true },
};
const AI_FALLBACKS = (process.env.AI_FALLBACKS || "cloudflare,gemini,cerebras,openrouter,mistral").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
const CHAIN = [AI_PROVIDER, ...AI_FALLBACKS.filter((p) => p !== AI_PROVIDER)];

const TIERS = ["Excellent", "Strong", "Good", "Moderate", "Low"];
const ELIGIBILITY = ["worldwide", "international", "country-restricted", "regional/timezone"];
const wib = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const cutoff = Date.now() - 30 * 86400_000;
const strip = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&#x2F;/gi, "/").replace(/&#x3A;/gi, ":").replace(/&#x27;/gi, "'").replace(/&quot;/gi, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const daysOld = (d) => { const t = Date.parse(d); return Number.isFinite(t) ? (Date.now() - t) / 86400_000 : null; };
const FRESH = (d) => { const a = daysOld(d); return a == null || a <= 30; };

function fail(msg, causes = []) {
  console.error("FATAL:", msg);
  const note = `⚠️ _Rails Remote Jobs — ${wib}_ could not be produced. ${msg}`.slice(0, 400);
  if (DRY_RUN) { console.error("dry run — not posting failure note to Slack"); process.exit(1); }
  return postToSlack([note]).then(() => { try { writeFileSync("failure-posted", "1"); } catch {} process.exit(1); }).catch(() => process.exit(1));
}

async function fetchText(url, { timeout = 25000, headers = {}, ua = "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0" } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { "User-Agent": ua, "Accept": "application/json,application/rss+xml,text/xml,*/*", ...headers }, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return { text: await res.text(), url: res.url };
  } finally { clearTimeout(t); }
}
const dedupeKey = (j) => (j.company || "").toLowerCase().replace(/[^a-z0-9]+/g, "") + "|" + (j.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const dedupeUrl = (u) => String(u || "").toLowerCase().replace(/\/$/, "");

// ---------- sources ----------
async function fromRemotive() {
  const { text } = await fetchText("https://remotive.com/api/remote-jobs?search=ruby");
  const jobs = (JSON.parse(text).jobs) || [];
  return jobs.filter((j) => (j.publication_date || "") >= new Date(cutoff).toISOString().slice(0, 10))
    .filter((j) => /ruby|rails/i.test(JSON.stringify(j)))
    .map((j) => ({ source: "remotive", company: j.company_name || "Unknown", title: j.title || "Unknown", url: j.url || "", postedAt: (j.publication_date || "").slice(0, 10), location: j.candidate_required_location || "Remote", salary: j.salary || "", description: strip(j.description).slice(0, 250) }));
}
async function fromRemoteOk() {
  const { text } = await fetchText("https://remoteok.com/api?tag=ruby");
  const items = JSON.parse(text);
  return items.filter((j) => j && typeof j === "object" && j.position)
    .filter((j) => FRESH(j.date))
    .filter((j) => /ruby|rails/i.test(JSON.stringify(j)))
    .map((j) => ({ source: "remoteok", company: (j.company || "Unknown").trim(), title: (j.position || "Unknown").trim(), url: j.url || "", postedAt: (j.date || "").slice(0, 10), location: (j.location || "Remote").trim(), salary: (j.salary || "").trim(), description: strip(j.description).slice(0, 250) }));
}
async function fromWwr() { // Cloudflare-gated; kept for completeness, expected to fail
  const { text } = await fetchText("https://weworkremotely.com/categories/remote-ruby-on-rails-jobs.rss", { timeout: 15000 });
  const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map((raw) => {
    const title = strip((raw.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
    const link = strip((raw.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "");
    const pub = strip((raw.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "");
    const descM = raw.match(/<description>([\s\S]*?)<\/description>/);
    const desc = descM ? strip((descM[1].match(/<!\[CDATA\[([\s\S]*?)\]\]>/) || [null, descM[1]])[1]).slice(0, 300) : "";
    const cm = title.match(/^(.*?)\s*[-:|—]\s*(.+)$/);
    return { source: "weworkremotely", company: cm ? cm[1].trim() : "Unknown", title: cm ? cm[2].trim() : title, url: link, postedAt: (pub ? new Date(pub).toISOString().slice(0, 10) : ""), location: "Remote", salary: "", description: desc };
  }).filter((j) => FRESH(j.postedAt));
}
async function fromHn() {
  const search = await fetchText("https://hn.algolia.com/api/v1/search_by_date?query=%22who%20is%20hiring%22&tags=story&hitsPerPage=3");
  const hits = (JSON.parse(search.text).hits || []).filter((h) => /^Ask HN: Who is hiring\?/.test(h.title || ""));
  if (hits.length === 0) throw new Error("no Who is hiring thread found");
  const thread = hits[0];
  const threaded = await fetchText(`https://hn.algolia.com/api/v1/items/${thread.objectID}`, { timeout: 40000 });
  const t = JSON.parse(threaded.text);
  const out = [];
  const walk = (node) => {
    for (const c of node.children || []) {
      const text = strip(c.text || "");
      if (/rails/i.test(text)) {
        const cm = text.match(/^([^\|]{2,80}?)\s*\|\s*/);
        const urlM = text.match(/https?:\/\/[^\s<>()]+/i);
        let host = "";
        try { host = urlM ? new URL(urlM[0]).hostname.replace(/^www\./, "") : ""; } catch { host = ""; }
        const company = cm ? cm[1].trim() : (host || "See comment");
        const locM = text.match(/\b(worldwide|remote(?:[- ](?:first|only))?|anywhere|US|USA|Canada|UK|EU|Europe|Germany|Singapore|Australia|Japan|Remote)[^\n|,.]*/i);
        let title = (text.match(/(founding|full-?stack|back-?end|front-?end|platform|ruby|rails|lead|senior|staff|principal|engineer|developer)[^\n|]{0,80}/i) || ["Role"])[0];
        title = title.replace(/\s*(My name is|I am the|I'm the).*$/i, "").replace(/[.,;:][^.,;:]*$/, "").trim().slice(0, 60).replace(/[,.]$/, "");
        out.push({ source: "hn-whoishiring", company, title, url: urlM ? urlM[0].replace(/[.,)]$/, "") : `https://news.ycombinator.com/item?id=${c.id}`, postedAt: (thread.created_at || "").slice(0, 10), location: locM ? locM[0].trim() : "See comment", salary: (text.match(/\$[\d,.kK-]+/) || [""])[0] || "", description: text.slice(0, 300) });
      }
      walk(c);
    }
  };
  walk(t);
  return out;
}

const SOURCES = [
  ["remotive", fromRemotive],
  ["remoteok", fromRemoteOk],
  ["weworkremotely", fromWwr],
  ["hn-whoishiring", fromHn],
];
const statuses = [];

// ---------- AI ----------
async function callCompletion(prompt, { forceNoJsonMode = false } = {}) {
  const errors = [];
  for (const name of CHAIN) {
    const p = PROVIDERS[name];
    if (!p) { errors.push(`${name}: unknown provider`); continue; }
    const key = p.key();
    if (!key) { console.log(`ai: skipping ${name} (no credentials)`); continue; }
    const model = AI_MODEL || p.model();
    console.log(`ai: trying ${name} (model ${model})`);
    try {
      const res = await fetch(`${p.baseURL()}/chat/completions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 4096, temperature: 0.2, ...(p.jsonMode && !forceNoJsonMode ? { response_format: { type: "json_object" } } : {}) }),
      });
      if (!res.ok) { errors.push(`${name}: HTTP ${res.status} ${(await res.text()).slice(0, 900)}`); continue; }
      const data = await res.json();
      const raw = data?.choices?.[0]?.message?.content || "";
      if (!raw) { errors.push(`${name}: empty completion`); continue; }
      console.log(`ai: ${name} succeeded`);
      return raw;
    } catch (e) { errors.push(`${name}: ${String(e).slice(0, 200)}`); }
  }
  throw new Error(`all AI providers failed: ${errors.join(" | ")}`);
}

const PROFILE = `Senior Full-Stack Developer — Ruby on Rails & React, 12+ years, based in Indonesia. Prefers fully-remote worldwide/international roles open to Indonesian applicants; EU/APAC/NA welcome; country-restricted roles downranked.
Scoring weights: Rails 25, seniority 20, remote-from-Indonesia 20, full-stack/React 10, backend architecture 10, stack 5, salary 5, company credibility 5.`;

async function score(candidates) {
  if (AI_STUB) return { jobs: candidates.map((_, index) => ({ index, score: 75, tier: "Good", eligibility: "international", restricts: "", why: "Stubbed scoring (AI_STUB)." })), summary: "Stubbed analysis (AI_STUB=true)." };
  const lines = candidates.map((j, i) =>
    `${i}. [${j.source}] ${j.company} — ${j.title} | loc: ${j.location || "?"} | posted: ${j.postedAt || "unknown"} | salary: ${j.salary || "n/a"}\n   ${j.description}`).join("\n");
  const prompt = `${PROFILE}

Score each numbered job for that candidate. Return ONLY this JSON (one entry per numbered job, same order):
{"jobs":[{"index":0,"score":75,"tier":"Good","eligibility":"worldwide","restricts":"","why":"why they should care"}],"summary":"one sentence overall"}
tier: Excellent|Strong|Good|Moderate|Low. eligibility: worldwide|international|country-restricted|regional/timezone. Do not invent facts; score only what is stated.
Jobs:
${lines}`;
  let parsed = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const forceNoJsonMode = attempt === 3;
    let raw;
    try {
      raw = await callCompletion(prompt + (attempt > 1 ? "\n\nYour previous reply was not valid JSON. Reply with ONLY the JSON object." : ""), { forceNoJsonMode });
    } catch (e) { console.error(`ai: attempt ${attempt}: ${String(e).slice(0, 600)}`); continue; }
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) { console.error(`ai: attempt ${attempt}: no JSON object`); continue; }
    try {
      const p = JSON.parse(m[0]);
      const jobs = (p.jobs || []).filter((j) => Number.isInteger(j.index) && j.index >= 0 && j.index < candidates.length)
        .map((j) => ({ index: j.index, score: Math.max(0, Math.min(100, Math.round(Number(j.score) || 0))), tier: TIERS.includes(j.tier) ? j.tier : "Moderate", eligibility: ELIGIBILITY.includes(j.eligibility) ? j.eligibility : "international", restricts: String(j.restricts || "").slice(0, 80), why: String(j.why || "").slice(0, 160) }));
      if (jobs.length === 0) { console.error(`ai: attempt ${attempt}: no valid job entries`); continue; }
      parsed = { jobs, summary: String(p.summary || "").slice(0, 300) };
      break;
    } catch (e) { console.error(`ai: attempt ${attempt}: ${e.message}`); }
  }
  if (!parsed) throw new Error("AI returned invalid JSON twice");
  return parsed;
}

// ---------- compose ----------
function render(ranked, sourceStatus, totalCandidates) {
  const order = { Excellent: 0, Strong: 1, Good: 2, Moderate: 3, Low: 4 };
  const sorted = [...ranked].sort((a, b) => order[a.tier] - order[b.tier] || b.score - a.score);
  const shown = sorted.filter((j, i) => ["Excellent", "Strong", "Good"].includes(j.tier) || i < 12).slice(0, 12);
  const notShown = ranked.length - shown.length;
  const header = `💼 _Rails Remote Jobs — ${wib} (Asia/Jakarta)_\nSources: ${sourceStatus.map(([n, ok, cnt]) => ok ? `✅ ${n} (${cnt})` : `❌ ${n}`).join(" · ")}\n${totalCandidates} fresh candidates (≤30d, deduped) — scored vs profile\n`;
  const body = shown.map((j, i) => `_${i + 1}. ${j.company} — ${j.title}_ · ${j.eligibility === "worldwide" ? "🌍 Worldwide" : j.eligibility === "international" ? "🌐 Intl" : j.eligibility === "country-restricted" ? "🔒 " + (j.restricts || "restricted") : "🕒 " + (j.restricts || "regional")} · **${j.tier} ${j.score}**${j.salary ? ` · ${j.salary}` : ""}\n→ ${j.url}\n💡 ${j.why}`).join("\n\n");
  const footer = `\n\n${notShown > 0 ? `_${notShown} more (Moderate/Low) not shown._` : ""}\n🤖 _Automated Rails job search · ${totalCandidates} candidates scored · verify eligibility per posting · sources: ${sourceStatus.filter(([, ok]) => ok).map(([n]) => n).join(", ")}_`;
  return header + "\n" + body + footer;
}

async function postToSlack(messages) {
  for (const text of messages) {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: SLACK_JOBS_CHANNEL_ID, text }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) throw new Error(`Slack post failed: ${body.error || res.status}`);
  }
  console.log(`Slack post: ok (${messages.length} message(s))`);
}

(async () => {
  if (!DRY_RUN && (!SLACK_BOT_TOKEN || !SLACK_JOBS_CHANNEL_ID)) { console.error("FATAL: SLACK_BOT_TOKEN and SLACK_JOBS_CHANNEL_ID required (or DRY_RUN=true)"); process.exit(1); }
  if (!CF_ACCOUNT_ID && !CHAIN.some((n) => PROVIDERS[n]?.key()) && !AI_STUB) { console.error("FATAL: no AI provider credentials found"); process.exit(1); }
  const all = [];
  for (const [name, fn] of SOURCES) {
    try { const jobs = await fn(); all.push(...jobs); statuses.push([name, true, jobs.length]); console.log(`source ${name}: ${jobs.length} fresh jobs`); }
    catch (e) { statuses.push([name, false, 0]); console.error(`source ${name} FAILED: ${String(e).slice(0, 200)}`); }
  }
  const seenUrl = new Set(); const seenKey = new Set();
  const deduped = [];
  for (const j of all) {
    const u = dedupeUrl(j.url); const k = dedupeKey(j);
    if (u && seenUrl.has(u)) continue; if (seenKey.has(k)) continue;
    if (u) seenUrl.add(u); seenKey.add(k); deduped.push(j);
  }
  const candidates = deduped.filter((j) => FRESH(j.postedAt)).slice(0, 40);
  console.log(`candidates after dedupe+fresh: ${candidates.length} (dropped ${deduped.length - candidates.length} undated/older)`);
  if (candidates.length === 0) { await fail("no candidates from any source (all failed or nothing fresh)"); return; }
  let scored;
  try { scored = await score(candidates); } catch (e) { await fail(`AI analysis failed: ${String(e).slice(0, 300)}`); return; }
  const ranked = scored.jobs.map((s) => ({ ...candidates[s.index], ...s }));
  const msg = render(ranked, statuses, candidates.length);
  const parts = msg.length <= 3500 ? [msg] : msg.match(/[\s\S]{1,3400}(\n|$)/g);
  if (DRY_RUN) { console.log("=== DRY RUN — would post to #jobs ===\n" + parts.map((p, i) => `--- part ${i + 1} (${p.length} chars) ---\n${p}`).join("\n") + `\n=== end dry run ===`); return; }
  await postToSlack(parts);
  console.log(JSON.stringify({ event: "rails-jobs-posted", date: wib, candidates: candidates.length, shown: Math.min(ranked.length, 12) }));
})().catch((e) => fail(`unexpected error: ${String(e).slice(0, 300)}`));
