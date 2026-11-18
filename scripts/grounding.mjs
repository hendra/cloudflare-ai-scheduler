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
  // The scale word belongs to the figure: "$1.5 million" must normalise to 1500000, or a
  // source stating it verbatim would still fail the gate.
  /(?:Rp\.?|USD|EUR|\$)\s?\d[\d.,]*(?:\s*(?:ribu|juta|miliar|milyar|triliun|thousand|million|billion|trillion))?/gi,
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

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n/;
const FENCE_LINE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const INDENTED_CODE_RE = /^(?: {4}|\t)/;
const INLINE_CODE_RE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;
const LINK_RE = /\[([^\]]*)\]\([^()\s]*\)/g;
const BARE_URL_RE = /<?https?:\/\/[^\s>)\]]+/gi;

// The parts of a markdown body that can carry a claim: code samples and URLs cannot. Handles
// every fence style a model emits (``` and ~~~, any run length, indented, or left unclosed) and
// indented code blocks, because a number inside a sample must never count as a claim.
export function proseOnly(markdown) {
  const kept = [];
  let fence = null;
  for (const line of String(markdown).replace(FRONTMATTER_RE, "").split("\n")) {
    const marker = line.match(FENCE_LINE_RE);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (marker) { fence = marker[1]; continue; }
    if (INDENTED_CODE_RE.test(line)) continue;
    kept.push(line);
  }
  return kept.join("\n")
    .replace(INLINE_CODE_RE, " ")
    .replace(LINK_RE, "$1")
    .replace(BARE_URL_RE, " ")
    .replace(/\|\s*:?-{2,}:?\s*/g, " ")
    .replace(/[|*_#>]/g, " ");
}

const DROP_BLOCKS_RE = /<(script|style|nav|header|footer|aside|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const TEXT_BLOCKS_RE = /<(p|li|pre|td|dd|blockquote|div)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
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
export function extractPageText(html, cap = 200_000) {
  const cleaned = String(html).replace(DROP_BLOCKS_RE, " ");
  const parts = [];
  for (const re of [TEXT_BLOCKS_RE]) {
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
    // Stop reading at the cap instead of downloading a 50 MB page to then slice it.
    const chunks = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      while (total < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
      reader.cancel().catch(() => {});
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, MAX_BYTES);
    const text = extractPageText(buf.toString("utf-8"));
    if (text.length < MIN_SOURCE_CHARS) return fail(res.status);
    // Full page text: the gate must see numbers that sit deep in a long doc. Only the prompt
    // block is capped (blog-grounding.mjs REPAIR_SOURCE_CAP, writers' signal block).
    return { ok: true, status: res.status, text };
  } catch {
    return fail();
  }
}

// ---------- the gate ----------

// Every risky number in the prose must appear in at least one readable source, and every
// cited source must be readable. Sources that returned no text are dead, not harmless.
export function checkGrounding({ body = "", sources = [], minChars = MIN_SOURCE_CHARS } = {}) {
  const deadSources = [];
  const allowed = new Set();
  for (const src of sources) {
    const text = String(src?.text || "");
    if (text.trim().length < minChars) { deadSources.push(String(src?.url || "")); continue; }
    for (const n of numbersIn(text, { keepRaw: false })) allowed.add(n);
  }
  // "Node 20" is grounded by a source saying "Node.js 20.11.1": the leading component of a
  // dotted version the source states is the same version, not an invented number.
  const versionParts = new Set();
  for (const n of allowed) {
    const parts = n.split(".");
    for (let i = 1; i < parts.length; i++) versionParts.add(parts.slice(0, i).join("."));
  }
  const unverified = riskyNumbers(proseOnly(body)).filter((n) => !allowed.has(n) && !versionParts.has(n));
  const errs = [
    ...deadSources.map((u) => `cited source has no readable text: ${u}`),
    ...unverified.map((n) => `number not found in any source: ${n}`),
  ];
  return { ok: errs.length === 0, errs, unverified, deadSources };
}
