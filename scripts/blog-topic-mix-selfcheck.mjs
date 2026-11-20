// Assert-based self-check for scripts/blog-topic-mix.mjs (no framework, offline).
// Run: node scripts/blog-topic-mix-selfcheck.mjs
import assert from "node:assert/strict";

const { pickCategory, HENDRANICHOLAS_SHARES } = await import("./blog-topic-mix.mjs");

assert.equal(pickCategory(HENDRANICHOLAS_SHARES, {}), "Next.js");
assert.equal(pickCategory(HENDRANICHOLAS_SHARES, { "Next.js": 1 }), "FastAPI");

// Feeding 100 picks back in converges to the target shares exactly.
const counts = {};
for (let i = 0; i < 100; i++) {
  const c = pickCategory(HENDRANICHOLAS_SHARES, counts);
  counts[c] = (counts[c] ?? 0) + 1;
}
assert.deepEqual(counts, {
  "Next.js": 30,
  "FastAPI": 30,
  "Rust": 10,
  "Go": 10,
  "Ruby on Rails": 5,
  "AI Integration": 15,
});

// Categories outside `shares` are never picked and don't count toward the total.
assert.equal(pickCategory({ A: 0.5, B: 0.5 }, { A: 1, Other: 50 }), "B");

console.log("topic-mix self-check: ok");
