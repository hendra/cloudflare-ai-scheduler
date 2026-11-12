// Shared AI provider configuration for all scripts in this repo.
// Primary: OpenCode Console (opencode.ai) — OpenAI-compatible chat-completions
// at `https://opencode.ai/inference/openai/v1` (pay-as-you-go, needs credits on
// the workspace) or `https://opencode.ai/inference/go/openai/v1` (Go plan).
// Fallbacks: OpenRouter (preset `@preset/ai-scheduler`) → Groq → Gemini → Kilo →
// Cloudflare.
// Never commit API keys — pass them via environment variables or .dev.vars (gitignored).
//
// Env:
//   AI_PROVIDER    primary provider (default "opencode")
//   AI_FALLBACKS   comma-separated fallbacks (default "openrouter,groq,gemini,cloudflare"
//                  when unset; empty string forces no fallbacks). Providers without
//                  credentials are skipped.
//   AI_MODEL       model override for the PRIMARY provider only; fallbacks always
//                  use their own <PROVIDER>_MODEL default.
//   AI_TIMEOUT_MS  per-request timeout in milliseconds (default 90000; covers long
//                  article bodies). On timeout the provider is skipped and the
//                  chain falls through to the next one.
//   OPENCODE_API_KEY   OpenCode Console API key (oc_sk_…).
//   OPENCODE_MODEL     Console model (default "glm-5.3-flash-free" — "GLM-5.3-Flash Free").
//   OPENCODE_BASE_URL  Console base (default "https://opencode.ai/inference/openai/v1"
//                      — pay-as-you-go; the Go plan is
//                      "https://opencode.ai/inference/go/openai/v1").
//   OPENROUTER_API_KEY / OPENROUTER_MODEL  OpenRouter provider.
//   GROQ_API_KEY / GROQ_MODEL              Groq provider.
//   GEMINI_API_KEY (or GOOGLE_API_KEY) / GEMINI_MODEL   Gemini provider.
//   KILO_API_KEY / KILO_MODEL   Kilo AI Gateway provider (base
//                  "https://ai-gateway.kilo.ai/api/v1", model "kilo-auto/free").
//                  The free tier works without a key (200 requests/hour per IP);
//                  a key only raises limits.
//   CF_ACCOUNT_ID / CF_API_TOKEN / CLOUDFLARE_MODEL     Cloudflare Workers AI provider.
//   OLLAMA_BASE_URL / OLLAMA_MODEL  local Ollama provider (skipped when unset).

export const PROVIDERS = {
  opencode: {
    name: "opencode",
    baseURL: () =>
      process.env.OPENCODE_BASE_URL ||
      "https://opencode.ai/inference/openai/v1",
    key: () => process.env.OPENCODE_API_KEY || "",
    model: () => process.env.OPENCODE_MODEL || "glm-5.3-flash-free",
  },
  openrouter: {
    name: "openrouter",
    baseURL: () => "https://openrouter.ai/api/v1",
    key: () => process.env.OPENROUTER_API_KEY || "",
    model: () => process.env.OPENROUTER_MODEL || "@preset/ai-scheduler",
    jsonMode: false,
  },
  groq: {
    name: "groq",
    baseURL: () => "https://api.groq.com/openai/v1",
    key: () => process.env.GROQ_API_KEY || "",
    model: () => process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    jsonMode: true,
  },
  gemini: {
    name: "gemini",
    baseURL: () => "https://generativelanguage.googleapis.com/v1beta/openai",
    key: () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
    model: () => process.env.GEMINI_MODEL || "gemini-3.5-flash",
    jsonMode: true,
  },
  kilo: {
    name: "kilo",
    baseURL: () =>
      process.env.KILO_BASE_URL || "https://ai-gateway.kilo.ai/api/v1",
    key: () => process.env.KILO_API_KEY || "",
    model: () => process.env.KILO_MODEL || "kilo-auto/free",
    jsonMode: false,
    // Free tier works anonymously (200 requests/hour per IP); a key only raises limits.
    noAuth: true,
  },
  cloudflare: {
    name: "cloudflare",
    baseURL: () =>
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID || ""}/ai/v1`,
    key: () => process.env.CF_API_TOKEN || "",
    model: () => process.env.CLOUDFLARE_MODEL || "@cf/openai/gpt-oss-120b",
  },
  ollama: {
    name: "ollama",
    baseURL: () => process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
    key: () => process.env.OLLAMA_API_KEY || "ollama",
    model: () => process.env.OLLAMA_MODEL || "gemma4:e2b",
    think: false,
  },
};

export const AI_PROVIDER = (
  process.env.AI_PROVIDER || "opencode"
).toLowerCase();
export const AI_MODEL = process.env.AI_MODEL || "";
export const AI_FALLBACKS = (
  process.env.AI_FALLBACKS === undefined
    ? "openrouter,groq,gemini,kilo,cloudflare"
    : process.env.AI_FALLBACKS
)
  .toLowerCase()
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
export const AI_TIMEOUT_MS = Math.max(
  1,
  parseInt(process.env.AI_TIMEOUT_MS, 10) || 90_000,
);

// Transient rate limits (HTTP 429) are worth waiting out when the provider
// says when to come back: `retry-after` (seconds) and
// `x-ratelimit-reset-tokens` (seconds until the token window resets).
// OpenRouter's *daily* free-model cap 429 carries no retry hint, so it falls
// through to the next provider at once instead of waiting hours.
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
  let messages,
    maxTokens = 2800,
    temperature = 0.4,
    expectJSON = true,
    forceNoJsonMode = false;
  if (typeof promptOrOpts === "string") {
    messages = [{ role: "user", content: promptOrOpts }];
    ({
      maxTokens = 2800,
      temperature = 0.4,
      expectJSON = true,
      forceNoJsonMode = false,
    } = opts);
  } else if (Array.isArray(promptOrOpts)) {
    messages = promptOrOpts;
    ({
      maxTokens = 2800,
      temperature = 0.4,
      expectJSON = true,
      forceNoJsonMode = false,
    } = opts);
  } else {
    messages = promptOrOpts.messages;
    ({
      maxTokens = 2800,
      temperature = 0.4,
      expectJSON = true,
      forceNoJsonMode = false,
    } = promptOrOpts);
  }

  const chain = providerChain();
  const errors = [];
  for (const name of chain) {
    const p = PROVIDERS[name];
    if (!p) {
      errors.push(`${name}: unknown provider`);
      continue;
    }
    const key = p.key();
    if (!key && !p.noAuth) {
      console.log(`ai: skip ${name} (no credentials)`);
      continue;
    }
    const model = name === AI_PROVIDER && AI_MODEL ? AI_MODEL : p.model();
    try {
      // OpenRouter: the preset rejects `reasoning: { effort: "none" }` with HTTP 400
      // ("Model call failed: invalid request"), so reasoning is excluded instead —
      // `exclude: true` is accepted and keeps the whole token budget for the body.
      // Set OPENROUTER_REASONING_EFFORT to send `effort` instead (low/minimal/high).
      const payload = {
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
        ...(p.think !== undefined ? { think: p.think } : {}),
        ...(p.jsonMode && expectJSON && !forceNoJsonMode
          ? { response_format: { type: "json_object" } }
          : {}),
        ...(name === "openrouter"
          ? {
              reasoning: process.env.OPENROUTER_REASONING_EFFORT
                ? { effort: process.env.OPENROUTER_REASONING_EFFORT }
                : { exclude: true },
            }
          : {}),
      };
      // OpenCode Console routes a conversation by session id (required on Go).
      const sessionId = name === "opencode" ? `ses_${crypto.randomUUID()}` : "";
      const doFetch = (body) =>
        fetch(`${p.baseURL()}/chat/completions`, {
          method: "POST",
          headers: {
            ...(key ? { Authorization: `Bearer ${key}` } : {}),
            "Content-Type": "application/json",
            ...(sessionId ? { "x-opencode-session": sessionId } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(AI_TIMEOUT_MS),
        });
      let res = await doFetch(payload);
      let waits = 0;
      while (!res.ok && res.status === 429 && waits < MAX_RATE_WAITS) {
        const wait = rateLimitWaitMs(res);
        if (!wait) break; // no retry hint (e.g. a daily quota) — fall through now
        // A hard usage limit ("Free usage limit reached", "Insufficient balance")
        // will not clear by waiting — fall through to the next provider at once.
        const body = await res
          .clone()
          .text()
          .catch(() => "");
        if (
          /free usage limit|usage limit reached|insufficient balance/i.test(
            body,
          )
        ) {
          console.log(`ai: ${p.name} hard usage limit (429); not waiting`);
          break;
        }
        console.log(
          `ai: ${p.name} rate limited (429); waiting ${Math.round(wait / 1000)}s`,
        );
        await new Promise((r) => setTimeout(r, wait));
        res = await doFetch(payload);
        waits++;
      }
      if (!res.ok) {
        const errText = (await res.text()).slice(0, 400);
        if (
          p.jsonMode &&
          expectJSON &&
          !forceNoJsonMode &&
          errText.includes("json_validate_failed")
        ) {
          console.log(
            `ai: ${name} rejected JSON validation; retrying without response_format`,
          );
          res = await doFetch({ ...payload, response_format: undefined });
          if (res.ok) {
            const j2 = await res.json();
            const c2 = j2?.choices?.[0]?.message?.content || "";
            if (c2) {
              console.log(`ai: ${name} ok (no json mode)`);
              return c2;
            }
          }
          errors.push(`${name}: retry without response_format also failed`);
          continue;
        }
        errors.push(`${name}: HTTP ${res.status} ${errText}`);
        continue;
      }
      const j = await res.json();
      const content = j?.choices?.[0]?.message?.content || "";
      if (!content) {
        errors.push(`${name}: empty completion`);
        continue;
      }
      console.log(`ai: ${name} ok`);
      return content;
    } catch (e) {
      errors.push(`${name}: ${String(e).slice(0, 300)}`);
    }
  }
  throw new Error(`all AI providers failed: ${errors.join(" | ")}`);
}
