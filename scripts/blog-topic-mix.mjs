// Deterministic topic-mix picker: steers published blog categories toward target shares.

export const HENDRANICHOLAS_SHARES = {
  "Next.js": 0.30,
  "FastAPI": 0.30,
  "Rust": 0.10,
  "Go": 0.10,
  "Ruby on Rails": 0.05,
  "AI Integration": 0.15,
};

// Float noise (e.g. 0.1 * 101) must not override key-order tie-breaking.
const EPSILON = 1e-9;

/**
 * Returns the category furthest behind its share after one more post:
 * max of share * (total + 1) - count; ties go to the earlier `shares` key.
 * total counts only categories present in `shares`.
 */
export function pickCategory(shares, counts) {
  const keys = Object.keys(shares);
  const total = keys.reduce((sum, k) => sum + (counts[k] ?? 0), 0);
  let best = keys[0];
  let bestDeficit = -Infinity;
  for (const k of keys) {
    const deficit = shares[k] * (total + 1) - (counts[k] ?? 0);
    if (deficit > bestDeficit + EPSILON) {
      best = k;
      bestDeficit = deficit;
    }
  }
  return best;
}
