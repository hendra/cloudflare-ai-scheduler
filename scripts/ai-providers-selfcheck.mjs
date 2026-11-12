// Assert-based self-check for the AI provider chain (no framework).
// Run: node scripts/ai-providers-selfcheck.mjs
import assert from "node:assert/strict";

// Env is read at import time for the chain, at call time for keys/models.
process.env.AI_PROVIDER = process.env.AI_PROVIDER || "opencode";
delete process.env.AI_FALLBACKS;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

const { PROVIDERS, providerChain } = await import("./ai-providers.mjs");

assert.deepEqual(providerChain(), ["opencode", "openrouter", "groq", "gemini", "kilo", "cloudflare"]);

// Fallbacks keep their own models; the primary honours AI_MODEL only.
assert.equal(PROVIDERS.groq.model(), "openai/gpt-oss-120b");
assert.equal(PROVIDERS.gemini.model(), "gemini-3.5-flash");
assert.equal(PROVIDERS.kilo.model(), "kilo-auto/free");
assert.equal(PROVIDERS.cloudflare.model(), "@cf/openai/gpt-oss-120b");

// Kilo's free tier needs no key (anonymous access), so it is never skipped.
assert.equal(PROVIDERS.kilo.noAuth, true);
assert.equal(PROVIDERS.kilo.key(), "");

// Providers without credentials are skipped (gemini accepts the Google AI Studio key).
process.env.GOOGLE_API_KEY = "test-key";
assert.equal(PROVIDERS.gemini.key(), "test-key");
process.env.GEMINI_API_KEY = "gemini-key";
assert.equal(PROVIDERS.gemini.key(), "gemini-key");

// Duplicate/unknown entries are dropped from the chain.
process.env.AI_FALLBACKS = "groq,opencode,nope";
const { providerChain: chain2 } = await import("./ai-providers.mjs?cachebust=1");
assert.deepEqual(chain2(), ["opencode", "groq"]);

console.log("ai-providers self-check: ok");
