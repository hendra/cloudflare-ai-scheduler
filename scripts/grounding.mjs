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
