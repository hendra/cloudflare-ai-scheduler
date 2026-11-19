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

// Preferred models (body generation) are tried before the chain, then fall through.
{
  process.env.AI_PROVIDER = "cloudflare";
  process.env.AI_FALLBACKS = "";
  process.env.CF_API_TOKEN = "cf";
  process.env.GROQ_API_KEY = "gq";
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  const mod = await import("./ai-providers.mjs?cachebust=2");
  assert.deepEqual(mod.LONGFORM_MODELS, [
    { provider: "groq", model: "qwen/qwen3.8-27b" },
    { provider: "gemini", model: "gemma-4-31b-it", timeoutMs: 240000 },
  ]);
  const calls = [];
  const realFetch = globalThis.fetch;
  const reply = (status, content) => new Response(JSON.stringify(status === 200 ? { choices: [{ message: { content } }] } : { error: "x" }), { status });
  try {
    let statusFor = () => 200;
    globalThis.fetch = async (url, init) => { const b = JSON.parse(init.body); calls.push(b.model); return reply(statusFor(b.model), `from ${b.model}`); };

    assert.equal(await mod.callModel("p", { expectJSON: false, prefer: mod.LONGFORM_MODELS }), "from qwen/qwen3.8-27b");
    assert.deepEqual(calls, ["qwen/qwen3.8-27b"]);

    // Preferred fails (500), gemini has no key → skipped, chain answers.
    calls.length = 0;
    statusFor = (m) => (m === "qwen/qwen3.8-27b" ? 500 : 200);
    assert.equal(await mod.callModel("p", { expectJSON: false, prefer: mod.LONGFORM_MODELS }), "from @cf/openai/gpt-oss-120b");
    assert.deepEqual(calls, ["qwen/qwen3.8-27b", "@cf/openai/gpt-oss-120b"]);

    // No prefer → chain only, unchanged behaviour.
    calls.length = 0;
    await mod.callModel("p", { expectJSON: false });
    assert.deepEqual(calls, ["@cf/openai/gpt-oss-120b"]);
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log("ai-providers self-check: ok");
