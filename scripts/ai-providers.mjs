// Shared AI provider configuration for all scripts in this repo.
// Production uses OpenRouter (preset `@preset/ai-scheduler`) with Groq and CF as fallbacks.
// Local development uses Ollama (`gemma4:e2b` by default; override with OLLAMA_MODEL).
// Never commit API keys — pass them via environment variables or .dev.vars (gitignored).
//
// Env:
//   AI_PROVIDER    primary provider (default "openrouter")
//   AI_FALLBACKS   comma-separated fallbacks (default "groq,cloudflare" when unset;
//                  empty string forces no fallbacks). Providers without credentials
//                  are skipped.
//   AI_MODEL       model override for the PRIMARY provider only; fallbacks always
//                  use their own <PROVIDER>_MODEL default (an OpenRouter preset id
//                  is meaningless to Groq/CF).
//   AI_TIMEOUT_MS  per-request timeout in milliseconds (default 90000; covers long
//                  article bodies). On timeout the provider is skipped and the
//                  chain falls through to the next one.
//   <PROVIDER>_MODEL  per-provider model override (CLOUDFLARE_MODEL, GROQ_MODEL,
//                  OPENROUTER_MODEL, GEMINI_MODEL, CEREBRAS_MODEL, MISTRAL_MODEL,
//                  OLLAMA_MODEL).

// Model defaults are chosen so a fallback provider can still satisfy the blog
// writers' 1500-word body gate: gpt-oss-20b lands at ~1150 words, llama-3.3-70b
// at ~450. gpt-oss-120b lands at ~1900-2250 words on both providers.
export const PROVIDERS = {
  cloudflare: { name: "cloudflare", baseURL: () => `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID || ""}/ai/v1`, key: () => process.env.CF_API_TOKEN || "", model: () => process.env.CLOUDFLARE_MODEL || "@cf/openai/gpt-oss-120b" },
  groq:       { name: "groq",       baseURL: () => "https://api.groq.com/openai/v1", key: () => process.env.GROQ_API_KEY || "", model: () => process.env.GROQ_MODEL || "openai/gpt-oss-120b", jsonMode: true },
  openrouter: { name: "openrouter", baseURL: () => "https://openrouter.ai/api/v1",  key: () => process.env.OPENROUTER_API_KEY    || "", model: () => process.env.OPENROUTER_MODEL  || "@preset/ai-scheduler", jsonMode: false },
  gemini:     { name: "gemini",     baseURL: () => "https://generativelanguage.googleapis.com/v1beta/openai", key: () => process.env.GEMINI_API_KEY || "", model: () => process.env.GEMINI_MODEL || "gemini-2.5-flash", jsonMode: true },
  cerebras:   { name: "cerebras",   baseURL: () => "https://api.cerebras.ai/v1", key: () => process.env.CEREBRAS_API_KEY || "", model: () => process.env.CEREBRAS_MODEL || "llama-3.3-70b", jsonMode: true },
  mistral:    { name: "mistral",    baseURL: () => "https://api.mistral.ai/v1", key: () => process.env.MISTRAL_API_KEY || "", model: () => process.env.MISTRAL_MODEL || "mistral-small-latest", jsonMode: true },
  ollama:     { name: "ollama",     baseURL: () => process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1", key: () => process.env.OLLAMA_API_KEY || "ollama", model: () => process.env.OLLAMA_MODEL || "gemma4:e2b", think: false },
};

export const AI_PROVIDER = (process.env.AI_PROVIDER || "openrouter").toLowerCase();
export const AI_MODEL = process.env.AI_MODEL || "";
export const AI_FALLBACKS = (process.env.AI_FALLBACKS === undefined ? "groq,cloudflare" : process.env.AI_FALLBACKS)
  .toLowerCase()
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
export const AI_TIMEOUT_MS = Math.max(1, parseInt(process.env.AI_TIMEOUT_MS, 10) || 90_000);

// Transient rate limits (HTTP 429) are worth waiting out: Groq's free tier is
// 8000 output tokens/min, so a second article body inside the same minute
// 429s. Groq sends `retry-after` (seconds) and `x-ratelimit-reset-tokens`
// (seconds until the token window resets). OpenRouter's *daily* free-model cap
// 429 carries no retry hint, so it falls through to the next provider at once
// instead of waiting hours.
const RATE_WAIT_CAP_MS = 70_000;
const MAX_RATE_WAITS = 2;

function rateLimitWaitMs(res) {
  const secs = Math.max(
    parseFloat(res.headers.get("retry-after") || "") || 0,
    parseFloat(res.headers.get("x-ratelimit-reset-tokens") || "") || 0,
  );
  return secs > 0 ? Math.min(secs * 1000, RATE_WAIT_CAP_MS) : 0;
}

export function providerChain() {
  const chain = [AI_PROVIDER];
  for (const p of AI_FALLBACKS) {
    if (p !== AI_PROVIDER && PROVIDERS[p] && !chain.includes(p)) chain.push(p);
  }
  return chain;
}

export async function callModel(promptOrOpts, opts = {}) {
  let messages, maxTokens = 2800, temperature = 0.4, expectJSON = true, forceNoJsonMode = false;
  if (typeof promptOrOpts === "string") {
    messages = [{ role: "user", content: promptOrOpts }];
    ({ maxTokens = 2800, temperature = 0.4, expectJSON = true, forceNoJsonMode = false } = opts);
  } else if (Array.isArray(promptOrOpts)) {
    messages = promptOrOpts;
    ({ maxTokens = 2800, temperature = 0.4, expectJSON = true, forceNoJsonMode = false } = opts);
  } else {
    messages = promptOrOpts.messages;
    ({ maxTokens = 2800, temperature = 0.4, expectJSON = true, forceNoJsonMode = false } = promptOrOpts);
  }

  const chain = providerChain();
  const errors = [];
  for (const name of chain) {
    const p = PROVIDERS[name];
    if (!p) { errors.push(`${name}: unknown provider`); continue; }
    const key = p.key();
    if (!key && name !== "ollama") { console.log(`ai: skip ${name} (no credentials)`); continue; }
    const model = name === AI_PROVIDER && AI_MODEL ? AI_MODEL : p.model();
    try {
      const payload = { model, messages, max_tokens: maxTokens, temperature, ...(p.think !== undefined ? { think: p.think } : {}), ...(p.jsonMode && expectJSON && !forceNoJsonMode ? { response_format: { type: "json_object" } } : {}), ...(name === "openrouter" ? { reasoning: { effort: process.env.OPENROUTER_REASONING_EFFORT || "none" } } : {}) };
      const doFetch = (body) => fetch(`${p.baseURL()}/chat/completions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${p.key()}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
      let res = await doFetch(payload);
      let waits = 0;
      while (!res.ok && res.status === 429 && waits < MAX_RATE_WAITS) {
        const wait = rateLimitWaitMs(res);
        if (!wait) break; // no retry hint (e.g. a daily quota) — fall through now
        console.log(`ai: ${p.name} rate limited (429); waiting ${Math.round(wait / 1000)}s`);
        await new Promise((r) => setTimeout(r, wait));
        res = await doFetch(payload);
        waits++;
      }
      if (!res.ok) {
        const errText = (await res.text()).slice(0, 400);
        if (p.jsonMode && expectJSON && !forceNoJsonMode && errText.includes("json_validate_failed")) {
          console.log(`ai: ${name} rejected JSON validation; retrying without response_format`);
          res = await doFetch({ ...payload, response_format: undefined });
          if (res.ok) {
            const j2 = await res.json();
            const c2 = j2?.choices?.[0]?.message?.content || "";
            if (c2) { console.log(`ai: ${name} ok (no json mode)`); return c2; }
          }
          errors.push(`${name}: retry without response_format also failed`);
          continue;
        }
        errors.push(`${name}: HTTP ${res.status} ${errText}`);
        continue;
      }
      const j = await res.json();
      const content = j?.choices?.[0]?.message?.content || "";
      if (!content) { errors.push(`${name}: empty completion`); continue; }
      console.log(`ai: ${name} ok`);
      return content;
    } catch (e) {
      errors.push(`${name}: ${String(e).slice(0, 300)}`);
    }
  }
  throw new Error(`all AI providers failed: ${errors.join(" | ")}`);
}
