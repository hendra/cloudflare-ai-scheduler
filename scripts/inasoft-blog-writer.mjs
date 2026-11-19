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
// INASOFT blog writer (PR + auto-merge) — deterministic, zero dependencies.
//
// Flow: fetch signals (HN front page + GitHub Trending) → load existing corpus
//   (title/slug list, blocks duplicates) → 1 AI completion picks a topic (metadata
//   included) → 1 AI completion writes the markdown article body (hard-validated) →
//   cover rendered by headless Chrome (scripts/cover/) → write .md + cover into the
//   site checkout → `npm run build` must pass → branch → commit → push → PR →
//   Slack #inasoft summary (SLACK_INASOFT_CHANNEL_ID). Any hard failure → Slack note, NO push, NO PR.
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

import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { join } from "node:path";

const PIPELINE = "blog:inasoft";

const DRY_RUN = String(process.env.DRY_RUN || "false") === "true";
const AI_STUB = process.env.AI_STUB === "true";
const SITE_DIR = process.env.SITE_DIR || "inasoft-site";
const SITE_URL = "https://inasoft.id";
const INDEXNOW_KEY = "3817864a76ab43dab819179b3d2f933f"; // public key file: https://inasoft.id/3817864a76ab43dab819179b3d2f933f.txt
const INASOFT_PAT = process.env.INASOFT_PAT || "";
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const SLACK_CHANNEL = process.env.SLACK_INASOFT_CHANNEL_ID || "";
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
// Mirrors inasoft-site src/lib/categories.ts — the schema refines that the subcategory belongs to the category.
const SUBCATEGORIES_BY_CATEGORY = {
  "ai-engineering": ["ai-agents", "rag", "mcp", "ai-automation", "llm-engineering"],
  "software-engineering": ["ruby-on-rails", "backend", "frontend", "database"],
  "panduan-bisnis": ["perencanaan-proyek", "saas", "modernisasi-sistem"],
  "cloud-devops": ["devops", "container", "cloud"],
};
const CATEGORY_VALUES = Object.keys(SUBCATEGORIES_BY_CATEGORY);
const SUBCATEGORY_VALUES = Object.values(SUBCATEGORIES_BY_CATEGORY).flat();
const categoryOf = (sub) => CATEGORY_VALUES.find((c) => SUBCATEGORIES_BY_CATEGORY[c].includes(sub));
const SEO_TITLE_MAX = 50; // inasoft-site schema: seoTitle.max(50)
const PILLAR_VALUES = ["software-bisnis", "ai-untuk-bisnis", "pengembangan-software", "tutorial-teknis"];
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
    const posted = await postToSlack([`⚠️ _INASOFT blog writer failed:_ ${msg}`.slice(0, 500)]);
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
  const body = `AI untuk bisnis membantu perusahaan mengotomatiskan alur kerja operasional, merangkum dokumen internal, dan mempercepat layanan pelanggan tanpa mengorbankan kontrol kualitas serta keamanan data. ${"Pendekatan bertahap memastikan implementasi berjalan terukur dan sesuai kebutuhan tim operasional. ".repeat(4)}

## Mengapa topik ini penting untuk bisnis Anda

INASOFT membantu perusahaan dari berbagai sektor di Indonesia mengadopsi teknologi modern secara bertahap dan aman. Pelajari juga [layanan pembuatan AI agent kami](/layanan/jasa-pembuatan-ai-agent), eksplorasi topik [AI untuk bisnis](/blog/topik/ai-untuk-bisnis), dan rujuk [dokumentasi resmi Node.js](https://nodejs.org/docs/latest/api/) untuk standar runtime modern. ${"Banyak proyek teknologi gagal bukan karena kodenya kurang bagus, melainkan karena arahnya tidak jelas, migrasinya dipaksakan dalam satu malam, dan timnya tidak dipersiapkan untuk perubahan cara kerja. Panduan ini ditulis dari pengalaman tim developer berpengalaman kami memimpin migrasi dan pembangunan aplikasi untuk klien INASOFT. ".repeat(35)}

| Pendekatan | Fokus Utama | Risiko Implementasi |
| --- | --- | --- |
| Otomasi bertahap | Satu alur kerja prioritas | Rendah dan terukur |
| Migrasi menyeluruh | Seluruh departemen sekaligus | Tinggi tanpa validasi |

${"Pendekatan kami selalu dimulai dari pemahaman masalah bisnis, bukan dari solusi teknis. Baru setelah itu kami merancang arsitektur yang sesuai dengan skala, anggaran, dan jadwal klien. ".repeat(25)}

## Cara memulai proyek dengan benar

Sebelum menulis baris kode pertama, ada beberapa hal yang harus dipastikan: kebutuhan bisnis utama, kriteria keberhasilan, dan prioritas fitur. Tanpa tiga hal itu, proyek akan terjebak dalam revisi tak berujung.

\`\`\`bash
# langkah pertama untuk memeriksa kesiapan
npm install
npm run dev
\`\`\`

${"Setelah kesiapan dasar terpenuhi, tim developer berpengalaman membangun fondasi yang solid: struktur folder, konfigurasi database, dan integrasi awal. Fondasi ini yang akan menentukan seberapa mudah tim mengembangkan fitur-fitur berikutnya. ".repeat(25)}

## Kesalahan umum saat memulai proyek teknologi

Banyak tim melakukan kesalahan yang sama: memilih teknologi terbaru tanpa memahami batasannya, mengabaikan kebutuhan operasi harian, atau mengerjakan fitur tambahan sebelum fitur inti stabil. Pola ini sering muncul karena tekanan waktu atau ambisi yang tidak seimbang dengan kapasitas tim.

${"Dua kesalahan yang paling mahal adalah: (1) memilih solusi yang terlalu kompleks untuk skala sesungguhnya, dan (2) mengabaikan keamanan serta audit trail hingga terlambat. Keduanya bisa dihindari dengan perencanaan yang realistis dan review berkala. ".repeat(25)}

## Kapan INASOFT bisa membantu

INASOFT memiliki tim developer berpengalaman menangani berbagai jenis proyek: pembangunan aplikasi web dan mobile, integrasi AI agent, migrasi database, dan modernisasi aplikasi legacy.

${"Jika Anda sedang mempertimbangkan langkah besar: membangun aplikasi baru, mengadopsi AI untuk otomasi proses, atau merencanakan migrasi sistem, INASOFT siap membantu sejak fase perencanaan hingga implementasi dan pemeliharaan. ".repeat(25)}

## Catatan verifikasi

> Catatan verifikasi: stub content untuk testing pipeline saja. Tidak untuk publikasi. Beberapa detail pada artikel ini sengaja disederhanakan untuk keperluan pipeline testing dan bukan rekomendasi produksi.

## Pertanyaan yang sering diajukan

### Apa yang dimaksud dengan panduan AI untuk bisnis?

Ini adalah panduan ringkas untuk pemilik bisnis dan manajer teknologi yang ingin memulai proyek otomasi dan perangkat lunak dengan langkah yang terukur.

### Kapan waktu yang tepat untuk menghubungi INASOFT?

Sejak fase perencanaan, sebelum kebutuhan menjadi terlalu kompleks atau ketika kendala operasional mulai menghambat produktivitas tim.

### Apakah INASOFT bisa bekerja sama dengan tim internal kami?

Ya, kami terbiasa berkolaborasi dengan tim teknis internal klien dan menyesuaikan alur pengembangan dengan standar perusahaan.

## Kesimpulan

Langkah pertama yang terbaik adalah memahami masalah bisnis yang ingin diselesaikan, lalu jadwalkan [Konsultasi Gratis](/#contact) untuk memetakan solusi yang aman dan sesuai prioritas operasional Anda.

${"Diskusi awal biasanya dimulai dari pertanyaan paling dasar: apa yang bisa ditingkatkan, apa yang paling penting, dan berapa sumber daya yang tersedia. Dari sana kami merancang rencana yang realistis. ".repeat(20)}`;
  return { topic: "Stub topik AI untuk INASOFT", keyword: "AI untuk bisnis", angle: "playbook praktis", rationale: "stub", title: "Stub Panduan AI untuk Bisnis di Indonesia", seoTitle: "Stub Panduan AI Bisnis", description: "Stub deskripsi untuk testing pipeline INASOFT: memvalidasi syarat SEO, kata kunci, dan kualitas draf sebelum artikel masuk ke proses tinjauan editorial.", slug: "stub-panduan-ai-untuk-bisnis", lang: "id", service: "jasa-pembuatan-ai-agent", category: "ai-engineering", subcategory: "ai-automation", pillar: "ai-untuk-bisnis", coverAlt: "Diagram ilustrasi stub", body };
}


// ---------- metadata helpers ----------
const DESC_MAX_CHARS = 160; // inasoft-site astro schema: description.max(160) — must match the site, not the old script limit
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
const META_KEYS = ["title", "seoTitle", "description", "keyword", "slug"];

function normalizeMetadataEnums(a) {
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
    a.subcategory = SUBCATEGORIES_BY_CATEGORY[a.category][0];
    console.warn("subcategory: fallback applied ->", a.subcategory);
  } else if (categoryOf(a.subcategory) !== a.category) {
    // The subcategory is the more specific choice; derive the category from it.
    console.warn(`category: "${a.category}" does not own subcategory "${a.subcategory}" -> ${categoryOf(a.subcategory)}`);
    a.category = categoryOf(a.subcategory);
  }
  if (!PILLAR_VALUES.includes(a.pillar)) {
    a.pillar = "pengembangan-software";
    console.warn("pillar: fallback applied ->", a.pillar);
  }
  if (!a.seoTitle) a.seoTitle = clampAtWord(a.title, SEO_TITLE_MAX);
  else if (a.seoTitle.length > SEO_TITLE_MAX) {
    const clamped = clampAtWord(a.seoTitle, SEO_TITLE_MAX);
    console.warn(`seoTitle clamped: ${a.seoTitle.length}c -> ${clamped.length}c`);
    a.seoTitle = clamped;
  }
  if (!a.lang) a.lang = "id";
}

// ---------- validation ----------
function validateArticle(a, corpusSlugs, extraCfg = {}) {
  normalizeMetadataEnums(a);
  return validateAeoGeo(a, {
    lang: "id",
    domain: "inasoft.id",
    seoTitleMax: SEO_TITLE_MAX,
    descMin: 100,
    descMax: DESC_MAX_CHARS,
    minWords: MIN_BODY_WORDS,
    trailingSlash: false,
    servicePrefix: "/layanan/",
    contactHref: "/#contact",
    requiredText: "Konsultasi Gratis",
    conclusionHeading: "Kesimpulan",
    faqHeading: "Pertanyaan yang sering diajukan",
    existingSlugs: corpusSlugs,
    bannedPatterns: [
      [/nomor 1|no\. ?1\b|#1\b/i, "unverifiable superlative"],
      [/engineer senior/i, 'say "tim developer berpengalaman"'],
      [/\bSeries A\b|\brunway\b|\bpendanaan\b/i, "startup-only framing"],
      [/\bRp ?\d/, "prices are never published"],
      [/sistem informasi/i, "not a confirmed offering"],
    ],
    ...extraCfg,
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
  let publishedRows;
  try {
    publishedRows = await fetchPublished({ pipeline: PIPELINE, limit: 500, dryRun: DRY_RUN });
  } catch (e) {
    await fail(`published ledger fetch failed: ${String(e?.message || e).slice(0, 220)}`);
    return;
  }
  let openPrs;
  try {
    openPrs = loadOpenPrs({ siteDir: SITE_DIR, pat: INASOFT_PAT, dryRun: DRY_RUN });
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
  const canonicalPosts = corpus.filter((c) => !c.draft && c.category && c.subcategory);
  const validBlogPaths = new Set([
    ...CATEGORY_VALUES.map((cat) => `/blog/${cat}`),
    ...PILLAR_VALUES.map((pil) => `/blog/topik/${pil}`),
    ...canonicalPosts.map((c) => `/blog/${c.category}/${c.subcategory}`),
    ...canonicalPosts.map((c) => `/blog/${c.category}/${c.subcategory}/${c.slug}`),
  ]);
  const topicPrompt = `You pick ONE blog topic for INASOFT (inasoft.id) — Indonesian IT company for software development, AI engineering, and digital transformation; readers: business owners and tech managers in Indonesia; pillars: AI engineering, modern software development, business software, cloud & DevOps. Pick the signal with the strongest, most durable angle for that audience.
Reply with ONLY this JSON (no prose):
{"signalIndex":<1..${signals.length}>,"topic":"short topic (Bahasa Indonesia)","keyword":"primary keyword","angle":"one-line angle","rationale":"why this wins","title":"article H1, 20-120 chars","seoTitle":"<= 50 chars","description":"120-160 chars","slug":"kebab-case-slug","lang":"id","service":"one of: ${SERVICE_VALUES.join("|")}","category":"one of: ${CATEGORY_VALUES.join("|")}","subcategory":"must belong to the chosen category — ${Object.entries(SUBCATEGORIES_BY_CATEGORY).map(([c, subs]) => `${c}: ${subs.join("|")}`).join("; ")}","pillar":"one of: ${PILLAR_VALUES.join("|")}"}
Avoid all of these existing posts: ${avoidPosts.join(" | ")}
Avoid these existing target keywords: ${existingKeywords.slice(0, 100).join(", ")}
Signals:
${signals.map((s, i) => `${i + 1}. [${s.source}] ${s.title} — ${s.description.slice(0, 160)} (${s.signals})`).join("\n")}`;
  let topic = AI_STUB ? {
    signalIndex: 1,
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
  normalizeMetadataEnums(meta);
  const existingLinks = canonicalPosts
    .slice(0, 40)
    .map((c) => `/blog/${c.category}/${c.subcategory}/${c.slug} — ${c.title}`);
  // Built from the passed article on every call: a 4a metadata fix can change
  // keyword/title/service, and the retry prompt must not demand the stale values.
  // Fetched once: the signal's own page is the only material the first draft can cite safely.
  const signalSource = AI_STUB || !chosenSignal?.url ? "" : (await fetchSourceText(chosenSignal.url)).text;
  const signalText = signalSource.slice(0, 6000);
  if (signalText) console.log(`signal source: ${signalText.length} chars from ${chosenSignal.url}`);
  const sourceBlock = signalText
    ? `\n\nSource material (facts you may state — never state a fact that is not here or in an official doc you can cite):\n${signalText}`
    : "";
  const makeBodyPrompt = (a) => {
    const aeoRules = buildAeoGeoBodyRules({
      siteName: "INASOFT",
      lang: "id",
      domain: "inasoft.id",
      voiceRule: 'first person plural ("kami") or clear consultative voice ("tim developer berpengalaman", NEVER "engineer senior"); practical, specific, honest about uncertainty, no marketing hype',
      keyword: a.keyword,
      serviceHref: servicePathFor("inasoft", a),
      contactHref: "/#contact",
      ctaInstruction: 'Include the exact phrase "Konsultasi Gratis" and link to `/#contact` in `## Kesimpulan`.',
      validPostLinks: existingLinks,
      extraRules: [
        "Use canonical `/blog/<category>/<subcategory>/<slug>` paths ONLY (NEVER flat `/blog/<slug>` and NEVER trailing slashes).",
        'Never mention "engineer senior", "Series A", "runway", "pendanaan", "sistem informasi", "nomor 1" / "#1", or prices in `Rp ...`.',
        "Be concrete: real file paths, real flags, real package names. Keep the tone informative for Indonesian business owners and engineering leads.",
      ],
    });
    return `Write the body of one INASOFT blog article.
Topic: ${a.topic}. Keyword: "${a.keyword}". Angle: ${a.angle}. Title: ${a.title}.
${aeoRules}
Return ONLY the article body as markdown: the opening paragraph and "##" sections. No title, no frontmatter, no preamble, no trailing notes.${sourceBlock}`;
  };
  const bodyModel = (p) => callModel(p, { maxTokens: 8000, expectJSON: false, prefer: LONGFORM_MODELS });
  // Links the code already knows are inserted, not left to the model (sourceUrl only when fetched,
  // so the grounding gate can read it). Applied to every body before it is validated.
  const withLinks = (a, text) => ensureRequiredLinks(text, { domain: "inasoft.id", lang: "id", serviceHref: servicePathFor("inasoft", a), contactHref: "/#contact", contactLabel: "Konsultasi Gratis", sourceUrl: signalSource ? chosenSignal.url : null, conclusionHeading: "Kesimpulan" });
  // Owner decision: a body that stays short after expansion is skipped (Slack note, exit 0), not a red run.
  const skipShort = async (words) => {
    const note = `⚠️ _Artikel blog INASOFT dilewati — terlalu pendek:_ *${meta.title}*\nIsi artikel tetap ${words} kata setelah diperluas (minimal ${MIN_BODY_WORDS}). Tidak ada yang dipublikasikan.`;
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
      const fixPrompt = `You previously produced this blog metadata JSON for inasoft.id:\n${JSON.stringify(metaNow)}\nIt failed validation: ${v.errs.filter(isMetaErr).join("; ")}.\nReturn ONLY a corrected JSON object with exactly the same keys. Hard constraints:\n- title: 20-120 chars, H1-style (Bahasa Indonesia)\n- seoTitle: at most 50 chars\n- description: 120-160 chars (hard max 160, inasoft-site schema) and MUST contain "${article.keyword}"\n- keyword: keep "${article.keyword}" unless it cannot fit; primary keyword only; NOT any existing target keyword\n- slug: kebab-case (a-z0-9 and hyphens), NOT any of: ${corpusSlugs.slice(0, 60).join(", ")}\nOutput ONLY the JSON object, no prose.`;
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
    const g = await groundArticle({ article, links: v.links, signalUrl: chosenSignal?.url || null, signalText: signalSource, callModel: (prompt) => callModel(prompt, { maxTokens: 8000, expectJSON: false }) });
    if (!g.ok) {
      const note = `⚠️ _Artikel blog INASOFT dilewati — fakta tidak terverifikasi:_ *${article.title}*\nAngka yang tidak ada di sumber mana pun: ${g.unverified.join(", ") || "(tidak ada)"}\nSitasi yang tidak bisa dibaca: ${g.deadSources.join(", ") || "(tidak ada)"}\nTidak ada yang dipublikasikan.`;
      try { await postToSlack([note]); } catch (e) { console.error("skip note failed:", e.message); }
      console.log(`skipping: ${note}`);
      process.exit(0);
    }
    if (g.body !== article.body) {
      article.body = withLinks(article, g.body);
      v = runValidate(article);
      if (!v.ok) { await fail(`article validation failed after grounding repair: ${v.errs.join("; ")}`); return; }
    }
    groundedLinks = v.links.length;
    console.log(`grounding ok — ${g.sources.length} source(s) read`);
  }

  // 5) cover
  const coverPath = join(SITE_DIR, "src/assets/blog", `${article.slug}.png`);
  try { article.coverAlt = await generateCover({ site: "inasoft", article, siteDir: SITE_DIR, outPath: coverPath, callModel, stub: AI_STUB }); console.log("cover generated:", coverPath); } catch (e) { await fail(e.message); return; }

  // 6) write .md
  const mdPath = join(SITE_DIR, "src/content/blog", `${article.slug}.md`);
  writeFileSync(mdPath, frontmatter(article));
  console.log("wrote", mdPath);

  // 7) format + post lint + check/build/audit must pass
  const relMdPath = join("src/content/blog", `${article.slug}.md`);
  console.log("formatting markdown with prettier …");
  try {
    execFileSync("npx", ["prettier", "--write", relMdPath], { cwd: SITE_DIR, stdio: "pipe" });
    execFileSync("npx", ["prettier", "--check", relMdPath], { cwd: SITE_DIR, stdio: "pipe" });
  } catch (e) {
    const out = (String(e.stdout || "") + "\n" + String(e.stderr || "")).trim();
    await fail(`prettier check failed for ${relMdPath}:\n${out.slice(-800) || e.message}`);
    return;
  }

  console.log("running site post check …");
  try {
    const chk = runSitePostCheck({ siteDir: SITE_DIR, relMdPath });
    if (chk.skipped) console.log("site post check skipped (no check script found)");
    else console.log("site post check passed:", chk.script);
  } catch (e) {
    await fail(e.message);
    return;
  }

  console.log("running astro check && astro build …");
  const buildEnv = { ...process.env, GSC_SERVICE_ACCOUNT_JSON: undefined };
  try {
    execSync("npm run check", { cwd: SITE_DIR, stdio: "pipe", timeout: 600000, env: buildEnv });
    execSync("npm run build", { cwd: SITE_DIR, stdio: "pipe", timeout: 600000, env: buildEnv });
  } catch (e) {
    const raw = String(e.stdout || "") + String(e.stderr || "");
    const lines = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
    await fail(`site build failed:\n${lines.slice(-30).join("\n") || "(no output captured from build)"}`);
    return;
  }
  console.log("build passed");

  console.log("running audit:seo …");
  const postPath = `/blog/${article.category}/${article.subcategory}/${article.slug}`;
  try {
    execSync("npm run audit:seo", { cwd: SITE_DIR, stdio: "pipe", timeout: 300000, env: buildEnv });
    console.log("audit:seo passed");
  } catch (e) {
    const raw = String(e.stdout || "") + "\n" + String(e.stderr || "");
    const lines = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
    const auditErrLines = lines.filter((l) => l.startsWith("- "));
    const postErrors = lines.filter((l) => l.includes(`${postPath}:`));
    if (postErrors.length > 0 || auditErrLines.length === 0) {
      await fail(`audit:seo failed for ${postPath}:\n${(postErrors.length > 0 ? postErrors : lines.slice(-30)).join("\n")}`);
      return;
    }
    console.log(`::warning title=audit:seo pre-existing issues::${auditErrLines.slice(0, 10).join(" | ")}`);
  }

  // 8) commit + PR (skipped in DRY_RUN)
  if (DRY_RUN) { console.log("=== DRY RUN — would open PR ==="); console.log(`title: content: add ${article.slug}`); console.log(`branch: blog/${article.slug}`); console.log(`description: ${article.description}`); return; }
  if (!INASOFT_PAT) await fail("INASOFT_PAT not set");
  const gitEnv = { ...process.env, GH_TOKEN: INASOFT_PAT };
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
  git(["-c", "user.name=inasoft-bot", "-c", "user.email=bot@inasoft.id", "commit", "-m", `content: add ${article.slug}`]);
  git(["push", "-u", "origin", branch]);
  const prBody = `## Summary\n- Article: **${article.title}** (keyword: ${article.keyword}, ~${v.wordCount} words)\n- Service angle: ${article.service || "(none)"}\n- Generated by the inasoft-blog-writer pilot pipeline from signals + corpus review; auto-merged by the pipeline after astro build passed.\n\n## Sources\n- Topic from signals; every cited page was fetched and the body checked against it.\n\n## Validation\n- [x] astro check && astro build passed\n- [x] description ${article.description.length}c · keyword in title/desc/intro\n- [x] ${groundedLinks} external citations fetched and grounding-checked`;
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
    ? `🖌️ _INASOFT article published_\n*${article.title}*\n→ ${pr}\n${v.wordCount} words · keyword: ${article.keyword}\n${ix.live ? `🔎 ${ix.url} · Bing: ${ix.bing} · Google sitemap: ${ix.google}` : `🔎 not live after 10 min — search engines not notified. Once it is deployed: \`node scripts/site-index.mjs ${SITE_URL} ${article.slug} ${INDEXNOW_KEY}\``}`
    : `🖌️ _INASOFT PR opened — auto-merge failed_\n*${article.title}*\n→ ${pr}\n${m.error}\nMerge it by hand.`]); }
  catch (e) { console.log(`::warning title=Slack summary not posted::${e.message} — PR ${pr} was opened; check the Slack channel secret / bot membership.`); }
})().catch(async (e) => { await fail(`unexpected error: ${String(e).slice(0, 300)}`); });
