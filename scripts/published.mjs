// Shared D1 published-items ledger client and URL/title deduplication helpers.
// Zero-dependency Node 20 ESM. Consumes Worker GET/POST /api/published.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const TRACKING_PARAMS = new Set([
  "ref",
  "source",
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
]);

const STOPWORDS = new Set(["the", "and", "dan", "yang"]);

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
};

const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [1000, 2000];
const MAX_POST_BATCH = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ledgerEnv() {
  const baseUrl = (process.env.SCHEDULER_URL || "").trim().replace(/\/+$/, "");
  const token = (process.env.MANUAL_RUN_TOKEN || "").trim();
  return { baseUrl, token };
}

export function canonicalUrl(rawUrl) {
  if (typeof rawUrl !== "string") return "";
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";

  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return "";
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") return "";

  u.hash = "";
  u.pathname = u.pathname.replace(/\/+$/, "") || "/";

  const kept = [];
  for (const [k, v] of u.searchParams.entries()) {
    const lower = k.toLowerCase();
    if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower)) continue;
    kept.push([k, v]);
  }
  kept.sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
  );
  u.search = kept.length ? new URLSearchParams(kept).toString() : "";

  return u.toString();
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&#(x[0-9a-fA-F]+|\d+);/g, (m, code) => {
      const cp = code[0] === "x" || code[0] === "X"
        ? parseInt(code.slice(1), 16)
        : parseInt(code, 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff
        ? String.fromCodePoint(cp)
        : m;
    })
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

export function normalizeTitle(text) {
  return decodeEntities(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokens(normalized) {
  const tokens = new Set();
  for (const w of normalized.split(" ")) {
    if (w.length >= 3 && !STOPWORDS.has(w)) tokens.add(w);
  }
  return tokens;
}

export function isSimilarTitle(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const ta = meaningfulTokens(na);
  const tb = meaningfulTokens(nb);
  if (ta.size === 0 || tb.size === 0) return false;

  let shared = 0;
  for (const tok of ta) {
    if (tb.has(tok)) shared += 1;
  }
  const union = ta.size + tb.size - shared;
  const jaccard = shared / union;

  if (shared >= 3 && jaccard >= 0.65) return true;
  if (shared >= 2 && (ta.size <= 2 || tb.size <= 2) && jaccard >= 0.75) return true;
  return false;
}

export function buildPublishedIndex(rows) {
  const keys = new Set();
  const urls = new Set();
  const titles = [];
  const metaList = [];

  for (const row of rows || []) {
    if (!row || typeof row !== "object") continue;
    if (row.item_key) keys.add(String(row.item_key));
    if (row.url) {
      const u = canonicalUrl(String(row.url));
      if (u) urls.add(u);
    } else if (row.item_key) {
      const u = canonicalUrl(String(row.item_key));
      if (u) urls.add(u);
    }
    if (row.title) titles.push(String(row.title));
    if (row.meta_json) {
      try {
        const parsed = JSON.parse(row.meta_json);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metaList.push(parsed);
      } catch {
        // Ignore malformed historical metadata.
      }
    }
  }

  return { keys, urls, titles, metaList };
}

export function filterUnseenCandidates(
  items,
  index,
  { getUrl, getTitle, getKey, extraKeys } = {},
) {
  const seenUrls = new Set(index?.urls || []);
  const seenKeys = new Set(index?.keys || []);
  if (extraKeys) {
    for (const k of extraKeys) {
      if (k) seenKeys.add(String(k));
    }
  }
  const seenTitles = [...(index?.titles || [])];
  const out = [];

  for (const item of items || []) {
    const url = typeof getUrl === "function" ? canonicalUrl(getUrl(item)) : "";
    if (url && seenUrls.has(url)) continue;

    const rawKey = typeof getKey === "function" ? getKey(item) : "";
    const key = rawKey ? String(rawKey) : "";
    if (key && seenKeys.has(key)) continue;

    const rawTitle = typeof getTitle === "function" ? getTitle(item) : "";
    const title = rawTitle ? String(rawTitle) : "";
    if (title && seenTitles.some((t) => isSimilarTitle(title, t))) continue;

    out.push(item);
    if (url) seenUrls.add(url);
    if (key) seenKeys.add(key);
    if (title) seenTitles.push(title);
  }

  return out;
}

export async function fetchPublished({ pipeline, days, limit, dryRun = false } = {}) {
  if (!pipeline) throw new Error("fetchPublished: pipeline is required");

  const { baseUrl, token } = ledgerEnv();
  const missing = [];
  if (!baseUrl) missing.push("SCHEDULER_URL");
  if (!token) missing.push("MANUAL_RUN_TOKEN");

  if (missing.length > 0) {
    if (dryRun) {
      console.log(`published: dryRun with missing ${missing.join(", ")}; returning []`);
      return [];
    }
    throw new Error(`fetchPublished failed: missing ${missing.join(", ")}`);
  }

  const u = new URL(`${baseUrl}/api/published`);
  u.searchParams.set("pipeline", pipeline);
  if (days !== undefined && days !== null) u.searchParams.set("days", String(days));
  if (limit !== undefined && limit !== null) u.searchParams.set("limit", String(limit));

  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const res = await fetch(u.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = await res.json();
        return Array.isArray(data?.items) ? data.items : [];
      }
      const errText = await res.text().catch(() => "");
      lastError = new Error(`GET /api/published HTTP ${res.status}: ${errText.slice(0, 200)}`);
      if (res.status < 500) break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  if (dryRun) {
    console.warn(`::warning::fetchPublished dryRun fallback to [] after error: ${lastError?.message}`);
    return [];
  }
  throw lastError;
}

export async function recordPublished({ pipeline, items, dryRun = false } = {}) {
  if (dryRun) return { ok: true, inserted: 0 };
  if (!Array.isArray(items) || items.length === 0) return { ok: true, inserted: 0 };
  if (!pipeline) {
    console.warn("::warning::recordPublished skipped: missing pipeline");
    return { ok: false, inserted: 0 };
  }

  const { baseUrl, token } = ledgerEnv();
  if (!baseUrl || !token) {
    console.warn("::warning::recordPublished skipped: missing SCHEDULER_URL or MANUAL_RUN_TOKEN");
    return { ok: false, inserted: 0 };
  }

  let inserted = 0;
  for (let i = 0; i < items.length; i += MAX_POST_BATCH) {
    const batch = items.slice(i, i + MAX_POST_BATCH);
    try {
      const res = await fetch(`${baseUrl}/api/published`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pipeline, items: batch }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.warn(`::warning::recordPublished HTTP ${res.status} for ${pipeline}: ${errText.slice(0, 200)}`);
        return { ok: false, inserted };
      }
      const data = await res.json();
      inserted += Number(data?.inserted || 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`::warning::recordPublished failed for ${pipeline}: ${msg}`);
      return { ok: false, inserted };
    }
  }

  return { ok: true, inserted };
}

function parseFrontmatterField(fm, key) {
  const m = fm.match(new RegExp(`(?:^|\\n)${key}:\\s*(.+?)\\r?$`, "m"));
  if (!m) return "";
  const raw = m[1].trim();
  if (!raw) return "";
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    try {
      return String(JSON.parse(raw)).trim();
    } catch {
      return raw.slice(1, -1).trim();
    }
  }
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1).replace(/''/g, "'").trim();
  }
  return raw;
}

export function loadBlogCorpus(siteDir) {
  const blogDir = join(siteDir, "src/content/blog");
  if (!existsSync(blogDir)) return [];
  const out = [];
  for (const f of readdirSync(blogDir)) {
    if (!f.endsWith(".md")) continue;
    const raw = readFileSync(join(blogDir, f), "utf8");
    const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const fm = fmMatch ? fmMatch[1] : raw;
    out.push({
      slug: f.replace(/\.md$/, ""),
      title: parseFrontmatterField(fm, "title") || f,
      keyword: parseFrontmatterField(fm, "keyword"),
      seoTitle: parseFrontmatterField(fm, "seoTitle"),
    });
  }
  return out;
}

export function loadOpenPrs({ siteDir, pat } = {}) {
  const slugs = new Set();
  const titles = [];
  if (!pat) {
    console.warn("::warning::loadOpenPrs skipped: missing PAT");
    return { slugs, titles };
  }
  try {
    const raw = execFileSync(
      "gh",
      ["pr", "list", "--state", "open", "--json", "headRefName,title", "--limit", "50"],
      {
        cwd: siteDir,
        env: { ...process.env, GH_TOKEN: pat },
        stdio: "pipe",
        timeout: REQUEST_TIMEOUT_MS,
      },
    ).toString();
    const prs = JSON.parse(raw);
    if (Array.isArray(prs)) {
      for (const pr of prs) {
        const ref = typeof pr?.headRefName === "string" ? pr.headRefName.trim() : "";
        if (ref.startsWith("blog/")) {
          const slug = ref.slice("blog/".length).trim().toLowerCase();
          if (slug) slugs.add(slug);
        }
        const title = typeof pr?.title === "string" ? pr.title.trim() : "";
        if (title) titles.push(title);
      }
    }
  } catch (err) {
    console.warn(`::warning::loadOpenPrs failed: ${String(err?.message || err).slice(0, 200)}`);
  }
  return { slugs, titles };
}

export function buildBlogHistory({
  corpus = [],
  openPrs = { slugs: new Set(), titles: [] },
  publishedRows = [],
} = {}) {
  const idx = buildPublishedIndex(publishedRows);
  const slugs = new Set();
  const urls = new Set(idx.urls);
  const titleSet = new Set();
  const titles = [];
  const keywords = new Set();

  const addSlug = (s) => {
    const clean = String(s || "").trim().toLowerCase();
    if (clean) slugs.add(clean);
  };
  const addTitle = (t) => {
    const clean = String(t || "").trim();
    if (clean && !titleSet.has(clean)) {
      titleSet.add(clean);
      titles.push(clean);
    }
  };
  const addKeyword = (kw) => {
    const nk = normalizeTitle(kw);
    if (nk) keywords.add(nk);
  };

  for (const c of corpus) {
    addSlug(c.slug);
    addTitle(c.title);
    if (c.seoTitle) addTitle(c.seoTitle);
    if (c.keyword) addKeyword(c.keyword);
  }
  for (const s of openPrs?.slugs || []) addSlug(s);
  for (const t of openPrs?.titles || []) addTitle(t);
  for (const k of idx.keys) addSlug(k);
  for (const t of idx.titles) addTitle(t);
  for (const m of idx.metaList) {
    if (m?.keyword) addKeyword(m.keyword);
  }

  return { slugs, urls, titles, keywords };
}

export function buildBlogAvoidList({
  corpus = [],
  openPrs = { titles: [] },
  publishedRows = [],
  max = 150,
} = {}) {
  const byNorm = new Map();
  const addEntry = (title, keyword = "") => {
    const cleanTitle = String(title || "").trim();
    const cleanKw = String(keyword || "").trim();
    const key = normalizeTitle(cleanTitle);
    if (!cleanTitle || !key) return;
    const existing = byNorm.get(key);
    if (!existing) byNorm.set(key, { title: cleanTitle, keyword: cleanKw });
    else if (!existing.keyword && cleanKw) existing.keyword = cleanKw;
  };

  for (const t of openPrs?.titles || []) addEntry(t);
  for (const row of publishedRows || []) {
    if (!row || typeof row !== "object") continue;
    let kw = "";
    if (row.meta_json) {
      try { kw = JSON.parse(row.meta_json)?.keyword || ""; } catch {}
    }
    addEntry(row.title, kw);
  }
  for (const c of corpus || []) addEntry(c.title, c.keyword);

  return [...byNorm.values()]
    .slice(0, max)
    .map(({ title, keyword }) => (keyword ? `${title} [kw: ${keyword}]` : title));
}

export function checkTopicCollision(candidate, history) {
  const { slug, title, topic, keyword, signalUrl } = candidate || {};
  const { slugs, urls, titles, keywords } = history || {};

  const normSlug = String(slug || "").trim().toLowerCase();
  if (normSlug && slugs?.has(normSlug)) {
    return `duplicate slug "${normSlug}"`;
  }

  const canonUrl = canonicalUrl(signalUrl);
  if (canonUrl && urls?.has(canonUrl)) {
    return `duplicate signalUrl "${canonUrl}"`;
  }

  const titleList = Array.isArray(titles) ? titles : [];
  if (title) {
    const matchedTitle = titleList.find((t) => isSimilarTitle(title, t));
    if (matchedTitle) return `similar title to "${matchedTitle}"`;
  }

  if (topic) {
    const matchedTopic = titleList.find((t) => isSimilarTitle(topic, t));
    if (matchedTopic) return `similar topic to "${matchedTopic}"`;
  }

  const normKw = normalizeTitle(keyword);
  if (normKw && keywords?.has(normKw)) {
    return `duplicate keyword "${normKw}"`;
  }

  return null;
}
