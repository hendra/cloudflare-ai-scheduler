// Factual-grounding helpers shared by the blog writers and the IG Reel pipelines.
// Deterministic, zero-dependency: numbers are extracted exactly as story.py:numbers_in does.

const SCALES = {
  ribu: 1e3, thousand: 1e3,
  juta: 1e6, million: 1e6,
  miliar: 1e9, milyar: 1e9, billion: 1e9,
  triliun: 1e12, trillion: 1e12,
};
const SCALE_RE = Object.keys(SCALES).join("|");
const NUM_RE = new RegExp(`(\\d+(?:[.,]\\d+)*)(?:\\s*(${SCALE_RE})\\b)?`, "gi");

// A separator followed by exactly 3 digits is a thousands separator (8.700 / 8,700),
// otherwise it is the decimal mark (1,5 / 1.5).
function normNumber(raw) {
  const parts = raw.split(/[.,]/);
  let out = parts[0];
  for (const p of parts.slice(1)) out += p.length === 3 ? p : "." + p;
  return out;
}

function formatScaled(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(15)));
}

export function numbersIn(text, { keepRaw = true } = {}) {
  const out = new Set();
  for (const match of String(text).matchAll(NUM_RE)) {
    const [raw, scale] = [match[1], match[2]];
    const value = normNumber(raw);
    if (scale) {
      if (keepRaw) out.add(value);
      const scaled = formatScaled(Number(value) * SCALES[scale.toLowerCase()]);
      if (scaled) out.add(scaled);
    } else {
      out.add(value);
    }
  }
  return out;
}

// Numbers that carry factual risk: anything with >= 2 digits, plus any figure used as a
// percentage, a currency amount or a version token. Four-digit years and small counts are
// exempt so ordinary prose ("3 layers", "as of 2026") never trips the gate.
const FLAGGED_RE = [
  /(?:Rp\.?|USD|EUR|\$)\s?\d[\d.,]*/gi,
  /\d[\d.,]*\s?%/g,
  /[A-Za-z]+-\d+(?:\.\d+)*/g,
  /\bv\d+(?:\.\d+)*/g,
];

const isYear = (n) => /^\d{4}$/.test(n) && Number(n) >= 1990 && Number(n) <= 2100;

export function riskyNumbers(text) {
  const src = String(text);
  const risky = new Set();
  const flagged = new Set();
  for (const re of FLAGGED_RE) {
    for (const match of src.matchAll(re)) {
      for (const n of numbersIn(match[0], { keepRaw: false })) {
        if (!isYear(n)) flagged.add(n);
      }
    }
  }
  for (const n of numbersIn(src, { keepRaw: false })) {
    if (isYear(n)) continue;
    if (/^\d+$/.test(n) && Number(n) < 10 && !flagged.has(n)) continue;
    risky.add(n);
  }
  for (const n of flagged) risky.add(n);
  return [...risky].sort();
}

// ---------- prose extraction ----------

const FENCE_RE = /^```[\s\S]*?^```[ \t]*$/gm;
const INLINE_CODE_RE = /`[^`\n]*`/g;
const LINK_RE = /\[([^\]]*)\]\((?:[^()\s]*)\)/g;
const BARE_URL_RE = /<?https?:\/\/[^\s>)\]]+/gi;
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n/;

// The parts of a markdown body that can carry a claim: code samples and URLs cannot.
export function proseOnly(markdown) {
  return String(markdown)
    .replace(FRONTMATTER_RE, "")
    .replace(FENCE_RE, " ")
    .replace(INLINE_CODE_RE, " ")
    .replace(LINK_RE, "$1")
    .replace(BARE_URL_RE, " ")
    .replace(/\|\s*:?-{2,}:?\s*/g, " ")
    .replace(/[|*_#>]/g, " ");
}

const DROP_BLOCKS_RE = /<(script|style|nav|header|footer|aside|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const TEXT_BLOCKS_RE = /<(p|li|pre|dd|blockquote)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
const TD_RE = /<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi;
const TAG_RE = /<[^>]+>/g;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function unescapeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, name) => {
    const key = String(name).toLowerCase();
    if (key.startsWith("#x")) return String.fromCodePoint(parseInt(key.slice(2), 16) || 32);
    if (key.startsWith("#")) return String.fromCodePoint(parseInt(key.slice(1), 10) || 32);
    return ENTITIES[key] ?? m;
  });
}

function toText(fragment) {
  return unescapeEntities(fragment.replace(TAG_RE, " ")).replace(/\s+/g, " ").trim();
}

// Readable page text for grounding. Wider than IG Reel's <p>-only rule on purpose: the blog
// prompt invites RFC/spec citations whose bodies live in <pre>/<li>/<td>.
export function extractPageText(html, cap = 6000) {
  const cleaned = String(html).replace(DROP_BLOCKS_RE, " ");
  const parts = [];
  for (const re of [TEXT_BLOCKS_RE, TD_RE]) {
    for (const m of cleaned.matchAll(re)) {
      const text = toText(m[m.length - 1]);
      if (text) parts.push(text);
    }
  }
  return parts.join("\n").slice(0, cap);
}

// ---------- source fetching ----------

const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0";
const MAX_BYTES = 2_000_000;
const MIN_SOURCE_CHARS = 200;

// A citation only grounds claims when it returns real page text: 2xx alone is not enough.
export async function fetchSourceText(url, { timeout = 25_000 } = {}) {
  const target = String(url || "").trim();
  const fail = (status = 0) => ({ ok: false, status, text: "" });
  let parsed;
  try { parsed = new URL(target); } catch { return fail(); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fail();
  try {
    const res = await fetch(target, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });
    if (res.status < 200 || res.status >= 300) return fail(res.status);
    const ctype = res.headers.get("content-type") || "";
    if (!ctype.toLowerCase().includes("html")) return fail(res.status);
    const buf = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_BYTES);
    const text = extractPageText(buf.toString("utf-8"));
    if (text.length < MIN_SOURCE_CHARS) return fail(res.status);
    return { ok: true, status: res.status, text };
  } catch {
    return fail();
  }
}
