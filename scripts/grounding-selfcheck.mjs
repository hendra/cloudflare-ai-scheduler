// Assert-based self-check for scripts/grounding.mjs (offline; no framework).
// Run: node scripts/grounding-selfcheck.mjs
import assert from "node:assert/strict";

const { numbersIn, riskyNumbers } = await import("./grounding.mjs");

// --- numbersIn: Indonesian vs English scale words, thousands vs decimal ---
assert.deepEqual([...numbersIn("8.700 pengguna")], ["8700"]);
assert.deepEqual([...numbersIn("8,700 users")], ["8700"]);
assert.deepEqual([...numbersIn("1,5 juta")], ["1.5", "1500000"]);
assert.deepEqual([...numbersIn("1,5 juta", { keepRaw: false })], ["1500000"]);
assert.deepEqual([...numbersIn("33 ribu orang")], ["33", "33000"]);
assert.deepEqual([...numbersIn("no digits here")], []);

// --- riskyNumbers: years exempt, small counts exempt, percent/currency/version kept ---
assert.deepEqual(riskyNumbers("shipped in 2026 with 3 layers"), []);
assert.deepEqual(riskyNumbers("since Node 20"), ["20"]);
assert.deepEqual(riskyNumbers("40% faster"), ["40"]);
assert.deepEqual(riskyNumbers("costs $19 per seat"), ["19"]);
assert.deepEqual(riskyNumbers("GPT-4o and the older model"), ["4"]);
assert.deepEqual(riskyNumbers("1,000 requests"), ["1000"]);

console.log("grounding-selfcheck: numbers ok");
