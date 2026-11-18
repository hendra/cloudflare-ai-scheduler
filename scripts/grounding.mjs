// Factual-grounding helpers shared by the blog writers and the IG Reel pipelines.
// Deterministic, zero-dependency: numbers are extracted exactly as story.py:numbers_in does.

const SCALES = {
  ribu: 1e3, thousand: 1e3,
  juta: 1e6, million: 1e6,
  miliar: 1e9, milyar: 1e9, billion: 1e9,
  triliun: 1e12, trillion: 1e12,
};
const SCALE_RE = Object.keys(SCALES).join("|");
// Short forms a writer actually types after a currency symbol: $1.5M, $250K. Only used with
// money, because "300 m" is 300 metres and "5 t" is 5 tonnes, not millions and trillions.
const SHORT_SCALES = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
const MONEY_RE = /(?:Rp\.?|USD|EUR|\$)\s?\d/gi;
const NUM_RE = new RegExp(`(\\d+(?:[.,]\\d+)*)(?:\\s*(${SCALE_RE})\\b)?`, "gi");
const MONEY_NUM_RE = new RegExp(`^(\\d+(?:[.,]\\d+)*)\\s*([KMBT])\\b`, "i");

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

// Short money forms ("$1.5M", "$250K") are only read as millions/billions right after a
// currency symbol: "300 m" is 300 metres and "5 t" is 5 tonnes, not 300 million and 5 trillion.
function moneyFigures(text) {
  const src = String(text);
  const stubs = new Set();
  const values = new Set();
  for (const m of src.matchAll(MONEY_RE)) {
    // Slice from the digit MONEY_RE consumed (it ends on the first digit), not the "$".
    const hit = src.slice(m.index + m[0].length - 1).match(MONEY_NUM_RE);
    if (!hit) continue;
    const stub = normNumber(hit[1]);
    const scaled = formatScaled(Number(stub) * SHORT_SCALES[hit[2].toLowerCase()]);
    if (!scaled) continue;
    stubs.add(stub);
    values.add(scaled);
  }
  return { stubs, values };
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
  const money = moneyFigures(text);
  for (const scaled of money.values) out.add(scaled);
  // "$1.5M" is one figure worth 1.5 million, not the 1.5 stub plus its own scale.
  if (!keepRaw) for (const stub of money.stubs) out.delete(stub);
  return out;
}

// Numbers that carry factual risk: anything with >= 2 digits, plus any figure used as a
// percentage, a currency amount or a version token. Four-digit years and small counts are
// exempt so ordinary prose ("3 layers", "as of 2026") never trips the gate.
const FLAGGED_RE = [
  // The scale word belongs to the figure: "$1.5 million" must normalise to 1500000, or a
  // source stating it verbatim would still fail the gate.
  /(?:Rp\.?|USD|EUR|\$)\s?\d[\d.,]*(?:\s*(?:ribu|juta|miliar|milyar|triliun|thousand|million|billion|trillion)|\s*[KMBT])?\b/gi,
  /\d[\d.,]*\s?%/g,
  /[A-Za-z]+-\d+(?:\.\d+)*/g,
  /\bv\d+(?:\.\d+)*/g,
];

const isYear = (n) => /^\d{4}$/.test(n) && Number(n) >= 1990 && Number(n) <= 2100;

export function riskyNumbers(text) {
  const src = String(text);
  const risky = new Set();
  const flagged = new Set();
  // A figure with a money short form ($1.5M) is judged as its full value, not the "1.5" stub.
  const moneyStubs = moneyFigures(src).stubs;
  for (const re of FLAGGED_RE) {
    for (const match of src.matchAll(re)) {
      for (const n of numbersIn(match[0], { keepRaw: false })) {
        if (!isYear(n) && !moneyStubs.has(n)) flagged.add(n);
      }
    }
  }
  for (const n of numbersIn(src, { keepRaw: false })) {
    if (isYear(n)) continue;
    if (moneyStubs.has(n)) continue;
    if (/^\d+$/.test(n) && Number(n) < 10 && !flagged.has(n)) continue;
    risky.add(n);
  }
  for (const n of flagged) risky.add(n);
  return [...risky].sort();
}

// ---------- prose extraction ----------

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n/;
const FENCE_LINE_RE = /^\s{0,3}(`{3,}|~{3,})/;
// A 4-space indent is an indented code block only when it does not continue a list item; a
// nested bullet or numbered item under "- Configure:" is prose and its numbers are claims.
const INDENTED_CODE_RE = /^(?: {4}|\t)(?!\s*(?:[-*+]|\d+[.)])\s)/;
const INLINE_CODE_RE = /(`+)([^`\n]|[^`\n][^`\n]*?[^`\n])\1(?!`)/g;
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
    if (marker) {
      // A fence opened and closed on one line hides only that line.
      const ticks = marker[1];
      const rest = line.slice(line.indexOf(ticks) + ticks.length);
      const closer = new RegExp(`[${ticks[0] === "`" ? "`" : "~"}]{${ticks.length},}`).exec(rest);
      if (!closer) fence = ticks;
      continue;
    }
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
const TEXT_BLOCKS_RE = /<(p|li|pre|td|dd|blockquote)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
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
// prompt invites RFC/spec citations whose bodies live in <pre>/<li>/<td>. A page with no
// semantic blocks at all (div-only) falls back to its whole stripped text rather than reading
// as dead.
export function extractPageText(html, cap = 200_000) {
  const cleaned = String(html).replace(DROP_BLOCKS_RE, " ");
  const parts = [];
  for (const m of cleaned.matchAll(TEXT_BLOCKS_RE)) {
    const text = toText(m[2]);
    if (text) parts.push(text);
  }
  const structured = parts.join("\n");
  const text = structured.length >= MIN_SOURCE_CHARS ? structured : toText(cleaned);
  return text.slice(0, cap);
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
  // "Node 20" is grounded by a source saying "Node.js 20.11.1", but ONLY as a bare integer
  // right after a version-ish word: a percentage or measurement is never licensed this way.
  // A bare version number ("Node 20") is grounded by a source's fuller version ("Node.js
  // 20.11.1"), but only right after a version-ish word: never for a percentage or measurement.
  const prefixes = new Set();
  for (const n of allowed) {
    if (!/^\d+\.\d/.test(n)) continue;
    const parts = n.split(".");
    for (let i = 1; i < parts.length; i++) prefixes.add(parts.slice(0, i).join("."));
  }
  const prose = proseOnly(body);
  const VERSION_WORDS = "(?:node|node\\.js|npm|rails|ruby|python|php|go|java|react|next\\.js|vue|postgres(?:ql)?|mysql|redis|chrome|firefox|safari|typescript|v)";
  const everyOccurrenceIsVersion = (n) => {
    const esc = n.replace(/\./g, "\\.");
    const occRe = new RegExp(`(?<![\\d.,])${esc}(?!\\d|[.,]\\d)`, "g");
    const prefixRe = new RegExp(`(?<![A-Za-z])${VERSION_WORDS}\\s*$`, "i");
    const unitAfterRe = /^\s*(?:%|persen|percent)\b/i;
    let seen = false;
    for (const m of prose.matchAll(occRe)) {
      seen = true;
      const before = prose.slice(0, m.index);
      const after = prose.slice(m.index + m[0].length);
      if (!prefixRe.test(before) || unitAfterRe.test(after)) return false;
    }
    return seen;
  };
  const unverified = riskyNumbers(prose).filter((n) => {
    if (allowed.has(n)) return false;
    if (!/^\d+(\.\d+)*$/.test(n) || !prefixes.has(n)) return true;
    return !everyOccurrenceIsVersion(n);
  });
  const errs = [
    ...deadSources.map((u) => `cited source has no readable text: ${u}`),
    ...unverified.map((n) => `number not found in any source: ${n}`),
  ];
  return { ok: errs.length === 0, errs, unverified, deadSources };
}
