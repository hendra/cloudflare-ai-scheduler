// Shared D1 published-items ledger client and URL/title deduplication helpers.
// Zero-dependency Node 20 ESM. Consumes Worker GET/POST /api/published.

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
        if (parsed && typeof parsed === "object") metaList.push(parsed);
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
