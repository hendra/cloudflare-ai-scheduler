#!/usr/bin/env node
import { PROVIDERS, providerChain, callModel } from "./ai-providers.mjs";
// INASOFT blog writer (pilot, PR-only) — deterministic, zero dependencies.
//
// Flow: fetch signals (HN front page + GitHub Trending) → load existing corpus
//   (title/slug list, blocks duplicates) → 1 AI completion picks a topic →
//   1 AI completion writes the article (JSON, hard-validated) → ImageMagick
//   text-on-brand cover → write .md + cover into the site checkout →
//   `astro check && astro build` must pass → branch → commit → push → PR →
//   Slack #fullstackwebdev summary. Any hard failure → Slack note, NO push, NO PR.
//
// Env:
//   SITE_DIR        path to the inasoft-site checkout (default: "inasoft-site")
//   DRY_RUN=true    everything except git push / PR / Slack (build still runs)
//   AI_STUB=true    deterministic fake article (offline testing; never pushed)
//   AI_PROVIDER / AI_FALLBACKS / AI_MODEL / <PROVIDER>_MODEL  (same as digests)
//   INASOFT_PAT      PAT with Contents RW + PR write on hendra/inasoft-site
//   SLACK_BOT_TOKEN, SLACK_INASOFT_CHANNEL_ID   (for the final summary note)
//   PUBLIC_FORMSPREE_FORM_ID  (astro env schema requires it at build time)
// Exit: 0 ok (PR opened or dry-run printed), 1 failure (Slack note attempted).

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { join, basename } from "node:path";

const DRY_RUN = String(process.env.DRY_RUN || "false") === "true";
const AI_STUB = process.env.AI_STUB === "true";
const SITE_DIR = process.env.SITE_DIR || "inasoft-site";
const INASOFT_PAT = process.env.INASOFT_PAT || "";
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const SLACK_CHANNEL = process.env.SLACK_INASOFT_CHANNEL_ID || "";
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "";
const CF_API_TOKEN = process.env.CF_API_TOKEN || "";
const AI_MODEL = process.env.AI_MODEL || "";

const SERVICE_VALUES = [
  "jasa-integrasi-ai-rag",
  "jasa-pembuatan-ai-agent",
  "jasa-ruby-on-rails",
  "jasa-pembuatan-software-custom",
  "jasa-pembuatan-aplikasi-web",
  "jasa-pembuatan-saas",
  "jasa-backend-developer",
  "jasa-integrasi-sistem",
  "jasa-integrasi-payment-gateway",
  "jasa-devops",
  "jasa-maintenance-aplikasi",
  "jasa-pembuatan-sistem-erp",
  "jasa-pembuatan-aplikasi-mobile",
];
const CATEGORY_VALUES = ["ai-engineering", "software-engineering", "panduan-bisnis", "cloud-devops"];
const SUBCATEGORY_VALUES = ["ai-agents", "rag", "mcp", "ai-automation", "llm-engineering", "ruby-on-rails", "backend", "frontend", "database", "perencanaan-proyek", "saas", "modernisasi-sistem", "devops", "container", "cloud"];
const PILLAR_VALUES = ["software-bisnis", "ai-untuk-bisnis", "pengembangan-software", "tutorial-teknis"];
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
  try { await postToSlack([`⚠️ _INASOFT blog writer failed:_ ${msg}`.slice(0, 500)]); try { writeFileSync("failure-posted", "1"); } catch {} } catch {}
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
// Free-tier Groq caps ~8k TPM per minute; one article needs 3-4 calls, so pace them.
const AI_CALL_SPACING_MS = 5000;

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
  const body = `## Mengapa topik ini penting untuk bisnis Anda
INASOFT membantu perusahaan dari berbagai sektor di Indonesia mengadopsi teknologi modern secara bertahap dan aman. ${"Banyak proyek teknologi gagal bukan karena kodenya kurang bagus, melainkan karena arahnya tidak jelas, migrasinya dipaksakan dalam satu malam, dan timnya tidak dipersiapkan untuk perubahan cara kerja. Panduan ini ditulis dari pengalaman konsultan senior kami memimpin migrasi dan pembangunan aplikasi untuk klien INASOFT. ".repeat(40)}
${"Pendekatan kami selalu dimulai dari pemahaman masalah bisnis, bukan dari solusi teknis. Baru setelah itu kami merancang arsitektur yang sesuai dengan skala, anggaran, dan jadwal klien. ".repeat(30)}

## Cara memulai proyek dengan benar
Sebelum menulis baris kode pertama, ada beberapa hal yang harus dipastikan: kebutuhan bisnis utama, kriteria keberhasilan, dan prioritas fitur. Tanpa tiga hal itu, proyek akan terjebak dalam revisi tak berujung.
\`\`\`bash
# langkah pertama untuk memeriksa kesiapan
npm install
npm run dev
\`\`\`
${"Setelah kesiapan dasar terpenuhi, tim engineering membangun fondasi yang solid: struktur folder, konfigurasi database, dan integrasi awal. Fondasi ini yang akan menentukan seberapa mudah tim mengembangkan fitur-fitur berikutnya. ".repeat(30)}

## Kesalahan umum saat memulai proyek teknologi
Banyak tim melakukan kesalahan yang sama: memilih teknologi terbaru tanpa memahami batasannya, mengabaikan kebutuhan operasi harian, atau mengerjakan fitur tambahan sebelum fitur inti stabil. Pola ini sering muncul karena tekanan waktu atau ambisi yang tidak seimbang dengan kapasitas tim.
${"Dua kesalahan yang paling mahal adalah: (1) memilih solusi yang terlalu kompleks untuk skala sesungguhnya, dan (2) mengabaikan keamanan serta audit trail hingga terlambat. Keduanya bisa dihindari dengan perencanaan yang realistis dan review berkala. ".repeat(30)}

## Kapan INASOFT bisa membantu
INASOFT memiliki tim yang berpengalaman menangani berbagai jenis proyek: pembangunan aplikasi web dan mobile, integrasi AI agent, migrasi database, dan modernisasi aplikasi legacy. \`layanan\` Kami bisa menjadi partner teknologi jangka panjang untuk perusahaan Anda.
${"Jika Anda sedang mempertimbangkan langkah besar: membangun aplikasi baru, mengadopsi AI untuk otomasi proses, atau merencanakan migrasi sistem, INASOFT siap membantu sejak fase perencanaan hingga implementasi dan pemeliharaan. ".repeat(25)}

## Catatan verifikasi
> Catatan verifikasi: stub content untuk testing pipeline saja. Tidak untuk publikasi. Beberapa detail pada artikel ini sengaja disederhanakan untuk keperluan pipeline testing dan bukan rekomendasi produksi.

## FAQ
*Apa yang dimaksud dengan panduan ini?* Ini adalah panduan ringkas untuk pemilik bisnis dan manajer teknologi yang ingin memulai proyek teknologi dengan langkah yang benar.
*Kapan waktu yang tepat untuk menghubungi INASOFT?* Sejak fase perencanaan, sebelum kebutuhan menjadi terlalu kompleks atau, sebaliknya, ketika masalah sudah mengancam operasional.
*Apakah INASOFT bisa bekerja sama dengan tim internal saya?* Ya, kami terbiasa berdiskusi dengan tim internal klien dan menyesuaikan pendekatan dengan budaya perusahaan.

## Kesimpulan
Langkah pertama yang terbaik adalah memahami masalah bisnis yang ingin diselesaikan. Baru setelah itu kami merancang solusi teknologi yang tepat, aman, dan sesuai anggaran. INASOFT siap menjadi partner Anda sejak langkah pertama.
${"Diskusi awal biasanya dimulai dari pertanyaan paling dasar: apa yang bisa ditingkatkan, apa yang paling penting, dan berapa sumber daya yang tersedia. Dari sana kami merancang rencana yang realistis. ".repeat(20)}`;
  return { topic: "Stub topik AI untuk INASOFT", keyword: "AI untuk bisnis", angle: "playbook praktis", rationale: "stub", title: "Stub Panduan AI untuk Bisnis di Indonesia", seoTitle: "Stub Panduan AI Bisnis", description: "Stub deskripsi untuk testing pipeline INASOFT: memvalidasi syarat SEO, kata kunci, dan kualitas draf sebelum artikel masuk ke proses tinjauan editorial.", slug: "stub-panduan-ai-untuk-bisnis", lang: "id", service: "jasa-pembuatan-ai-agent", category: "ai-engineering", subcategory: "ai-automation", pillar: "ai-untuk-bisnis", coverAlt: "Diagram ilustrasi stub", body };
}


// ---------- metadata helpers ----------
const DESC_MAX_CHARS = 180; // validation limit for description
// Clamp to max chars at a word boundary; hard cut if there is no decent boundary.
function clampAtWord(s, max) {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  const base = at >= 40 ? cut.slice(0, at) : t.slice(0, max);
  return base.trim().replace(/[\s.,;:!?—–-]+$/u, "");
}
const META_KEYS = ["title", "seoTitle", "description", "keyword", "slug", "coverAlt"];
const META_ERR = /^(title length|seoTitle|description|slug format|slug already exists|keyword)/;
const isMetaErr = (e) => META_ERR.test(e);

// ---------- validation ----------
function validateArticle(a, corpusSlugs) {
  const errs = [];
  const req = (cond, msg) => { if (!cond) errs.push(msg); };
  req(a.title && a.title.length >= 20 && a.title.length <= 120, "title length");
  
  req(a.description && a.description.length >= 100 && a.description.length <= 180, `description ${a?.description?.length} not in 100-180`);
  req(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.slug || ""), "slug format");
  // Services are required by the INASOFT schema (astro check). Tolerate model mistakes:
  // drop unknown slugs, and if none remain, pick the closest by simple keyword heuristics.
  // INASOFT schema: all enums are required. Tolerate model mistakes with heuristics.
  if (!SERVICE_VALUES.includes(a.service)) {
    const guess = ((a.keyword || "") + " " + (a.title || "")).toLowerCase();
    if (/\b(ai|agent|llm|rag|chatbot|gemini|claude)\b/i.test(guess)) a.service = "jasa-pembuatan-ai-agent";
    else if (/\b(rails|ruby)\b/i.test(guess)) a.service = "jasa-ruby-on-rails";
    else if (/\b(devops|kubernetes|k8s|cloud|docker|deploy)\b/i.test(guess)) a.service = "jasa-devops";
    else if (/\b(backend|api|rest|graphql)\b/i.test(guess)) a.service = "jasa-backend-developer";
    else a.service = "jasa-pembuatan-aplikasi-web";
    console.warn("service: fallback applied ->", a.service);
  }
  if (!CATEGORY_VALUES.includes(a.category)) {
    const guess = ((a.keyword || "") + " " + (a.title || "")).toLowerCase();
    a.category = /\b(ai|agent|llm|rag)\b/i.test(guess) ? "ai-engineering" : "software-engineering";
    console.warn("category: fallback applied ->", a.category);
  }
  if (!SUBCATEGORY_VALUES.includes(a.subcategory)) {
    a.subcategory = a.category === "ai-engineering" ? "llm-engineering" : "backend";
    console.warn("subcategory: fallback applied ->", a.subcategory);
  }
  if (!PILLAR_VALUES.includes(a.pillar)) {
    a.pillar = "pengembangan-software";
    console.warn("pillar: fallback applied ->", a.pillar);
  }
  if (!a.seoTitle) a.seoTitle = String(a.title || "").slice(0, 50);
  if (!a.lang) a.lang = "id";
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
  const norm = (t) => String(t || "").toLowerCase().replace(/[\u2010\u2011\u2012\u2013\u2014-]/g, " ").replace(/\s+/g, " ").trim();
  const kwWords = norm(kw).split(/\s+/).filter((w) => w.length > 2);
  const hay = norm((a.title || "") + " " + (a.description || "") + " " + bodyNoFences.slice(0, 2000));
  req(kwWords.slice(0, 1).every((w) => hay.includes(w)), "keyword missing from title/description/intro");
  req(/catatan verifikasi|verification note/i.test(a.body), "no verification note");
  req(CATEGORY_VALUES.includes(a.category), `category "${a.category}" not in allowed list`);
  req(SUBCATEGORY_VALUES.includes(a.subcategory), `subcategory "${a.subcategory}" not in allowed list`);
  req(PILLAR_VALUES.includes(a.pillar), `pillar "${a.pillar}" not in allowed list`);
  req(!a.service || SERVICE_VALUES.includes(a.service), `service "${a.service}" not in allowed list`);
  const links = a.body.match(/\]\((https?:\/\/[^)\s]+)\)/g) || [];
  return { ok: errs.length === 0, errs, wordCount: words, links: [...new Set(links.map((l) => l.slice(2, -1)))].slice(0, 15) };
}

// ---------- cover ----------
function makeCover(title, outPath) {
  execFileSync("python3", [join("scripts", "make-cover.py"), title, outPath], {
    stdio: "pipe",
    env: {
      ...process.env,
      BG_RGB: "9,13,22",
      STOP_1_RGB: "107,124,255",
      STOP_2_RGB: "139,158,255",
      SITE_LABEL: "inasoft.id",
      SITE_BADGE: "INASOFT",
    },
  });
}

// ---------- frontmatter ----------
function frontmatter(a) {
  const d = new Date();
  const pub = new Date(d.getTime() + 7 * 3600_000).toISOString().replace(/\.\d+Z$/, "+07:00");
  const svcLine = a.service ? `service: ${a.service}\n` : "";
  const subLine = a.subcategory ? `subcategory: ${a.subcategory}\n` : "";
  const pilLine = a.pillar ? `pillar: ${a.pillar}\n` : "";
  const langLine = a.lang ? `lang: ${a.lang}\n` : 'lang: id\n';
  const catLine = a.category ? `category: ${a.category}\n` : "";
  return `---\ntitle: ${JSON.stringify(a.title)}\nseoTitle: ${JSON.stringify(a.seoTitle || String(a.title || "").slice(0, 50))}\ndescription: ${JSON.stringify(a.description)}\nkeyword: ${JSON.stringify(a.keyword)}\n${catLine}${subLine}${pilLine}${langLine}pubDate: ${pub}\n${svcLine}cover: "../../assets/blog/${a.slug}.png"\ncoverAlt: ${JSON.stringify(a.coverAlt)}\ndraft: false\n---\n\n${a.body.trim()}\n`;
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
  const topicPrompt = `You pick ONE blog topic for INASOFT (inasoft.id) — Indonesian IT company for software development, AI engineering, and digital transformation; readers: business owners and tech managers in Indonesia; pillars: AI engineering, modern software development, business software, cloud & DevOps. Pick the signal with the strongest, most durable angle for that audience.
Reply with ONLY this JSON (no prose):
{"topic":"short topic (Bahasa Indonesia)","keyword":"primary keyword","angle":"one-line angle","rationale":"why this wins","title":"article H1, 20-120 chars","seoTitle":"<= 50 chars","description":"120-160 chars","slug":"kebab-case-slug","lang":"id","service":"one of: ${SERVICE_VALUES.join("|")}","category":"one of: ${CATEGORY_VALUES.join("|")}","subcategory":"one of: ${SUBCATEGORY_VALUES.join("|")} (must belong to category)","pillar":"one of: ${PILLAR_VALUES.join("|")}","coverAlt":"what the cover diagram shows"}
Avoid all of these existing posts: ${corpus.slice(0, 80).map((c) => c.title).join(" | ")}
Signals:
${signals.map((s, i) => `${i + 1}. [${s.source}] ${s.title} — ${s.description.slice(0, 160)} (${s.signals})`).join("\n")}`;
  let topic = AI_STUB ? {
    topic: "Stub topik AI untuk INASOFT",
    keyword: "AI untuk bisnis",
    angle: "practical guide",
    rationale: "stub",
    title: "Stub Panduan AI untuk Bisnis di Indonesia",
    seoTitle: "Stub Panduan AI Bisnis",
    description: "Stub deskripsi untuk testing pipeline INASOFT: memvalidasi syarat SEO, kata kunci, dan kualitas draf artikel sebelum masuk ke proses tinjaun editorial INASOFT.",
    slug: "stub-panduan-ai-untuk-bisnis",
    lang: "id",
    service: "jasa-pembuatan-ai-agent",
    category: "ai-engineering",
    subcategory: "ai-automation",
    pillar: "ai-untuk-bisnis",
    coverAlt: "Diagram ilustrasi stub"
  } : null;
  

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
  const existingSlugs = corpusSlugs;
  const bodyPrompt = `Write the body of one INASOFT (inasoft.id) blog article in Bahasa Indonesia. Voice: first person, senior full-stack and AI engineer from INASOFT — practical, specific, honest about uncertainty, no marketing copy, no hype.
Topic: ${topic.topic}. Keyword: "${meta.keyword}". Angle: ${topic.angle}. Title: ${meta.title}.
Requirements:
- 1800-2400 words. H2/H3 sections only, never a # H1 line.
- At least one fenced code example (typescript, javascript, ruby, bash, sql, or whatever fits the topic).
- An explicit blockquote "Catatan verifikasi" (Verification note) for anything unverified; never invent benchmarks, dates, or statistics.
- At most 2 internal links to these existing posts:
${existingLinks}
- Reference ONLY real URLs (official docs and the like). If a fact can't be verified, say so in the verification note rather than asserting it.
- Be concrete: real file paths, real flags, real package names. Generic advice is not acceptable.
- Keep the tone informative for Indonesian business owners and engineering leads.
Return ONLY the article body as markdown: the opening paragraph and "##" sections. No title, no frontmatter, no preamble, no trailing notes.`;
  const body = AI_STUB ? stubArticle().body : await (async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const text = await callModel(bodyPrompt + (attempt > 1 ? "\n\nYour previous attempt failed. Return ONLY the markdown body." : ""), { maxTokens: 8000, expectJSON: false });
        if (text && text.length > 1500) return text.replace(/^```(?:markdown)?\n/, "").replace(/\n```$/, "").trim();
        console.error(`body attempt ${attempt}: too short (${text?.length} chars)`);
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
      const fixPrompt = `You previously produced this blog metadata JSON for inasoft.id:\n${JSON.stringify(metaNow)}\nIt failed validation: ${v.errs.filter(isMetaErr).join("; ")}.\nReturn ONLY a corrected JSON object with exactly the same keys. Hard constraints:\n- title: 20-120 chars, H1-style (Bahasa Indonesia)\n- seoTitle: at most 50 chars\n- description: 100-180 chars (target 150-170) and MUST contain "${article.keyword}"\n- keyword: keep "${article.keyword}" unless it cannot fit; primary keyword only\n- slug: kebab-case (a-z0-9 and hyphens), NOT any of: ${corpusSlugs.slice(0, 60).join(", ")}\n- coverAlt: short diagram description\nOutput ONLY the JSON object, no prose.`;
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
    const retryBody = await (async () => {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const prompt = bodyPrompt + `\n\nYour previous draft failed validation: ${v.errs.join("; ")}. Return a corrected markdown body that fixes these issues. Return ONLY the body.`;
          const text = await callModel(prompt, { maxTokens: 8000, expectJSON: false });
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
  if (!INASOFT_PAT) await fail("INASOFT_PAT not set");
  const git = (args) => execSync(`git ${args}`, { cwd: SITE_DIR, stdio: "pipe", env: { ...process.env, GH_TOKEN: INASOFT_PAT } }).toString();
  const prBodyPath = join(SITE_DIR, ".pr-body.md");
  const branch = `blog/${article.slug}`;
  try { git(`checkout -B ${branch}`); } catch (e) { await fail(`git checkout: ${String(e.message).slice(0, 200)}`); return; }
  git("add src/content/blog src/assets/blog");
  git(`-c user.name="inasoft-bot" -c user.email="bot@inasoft.id" commit -m "content: add ${article.slug}"`);
  git(`push -u origin ${branch}`);
  const prBody = `## Summary\n- Article: **${article.title}** (keyword: ${article.keyword}, ~${v.wordCount} words)\n- Service angle: ${article.service || "(none)"}\n- Generated by the inasoft-blog-writer pilot pipeline from signals + corpus review; **requires human review before merge**.\n\n## Sources\n- Topic from signals; external links in the article are HEAD-verified.\n\n## Validation\n- [x] astro check && astro build passed\n- [x] description ${article.description.length}c · keyword in title/desc/intro\n- [x] ${v.links.length} external links HEAD-checked (${dead} dead)\n- [ ] **Human: verify version numbers, code examples run, and the voice matches the site.**\n\nDO NOT MERGE WITHOUT REVIEW.`;
  writeFileSync(prBodyPath, prBody);
  const pr = execSync(`gh pr create --base main --head ${branch} --title "content: add ${article.slug}" --body-file ${prBodyPath}`, { cwd: SITE_DIR, env: { ...process.env, GH_TOKEN: INASOFT_PAT }, stdio: "pipe" }).toString().trim();
  try { require('node:fs').unlinkSync(prBodyPath); } catch {}
  console.log("PR opened:", pr);
  await postToSlack([`🖌️ _INASOFT draft PR ready_\n*${article.title}*\n→ ${pr}\n${v.wordCount} words · keyword: ${article.keyword} · needs your review before merge.`]);
})().catch(async (e) => { await fail(`unexpected error: ${String(e).slice(0, 300)}`); });
