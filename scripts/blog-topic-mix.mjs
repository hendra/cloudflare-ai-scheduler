// Deterministic topic-mix picker: steers published blog categories toward target shares.

export const HENDRANICHOLAS_SHARES = {
  "Next.js": 0.30,
  "FastAPI": 0.30,
  "Rust": 0.10,
  "Go": 0.10,
  "Ruby on Rails": 0.05,
  "AI Integration": 0.15,
};

export const FULLSTACKWEB_SHARES = {
  "Python": 0.20,
  "Rust": 0.20,
  "Node": 0.20,
  "AI Engineering and Integration": 0.20,
  "Go": 0.15,
  "Rails": 0.05,
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

const AI_SERVICES = new Set(["ai-engineering", "ai-agent-development", "rag-llm-development"]);

/**
 * Classifies a fullstackweb.dev blog post into one of the 6 FULLSTACKWEB_SHARES stacks,
 * or null for Frontend / DevOps / stack-neutral posts.
 */
export function classifyFullstackwebTopic(post) {
  if (!post || typeof post !== "object") return null;
  const cat = String(post.category || "").trim().toLowerCase();
  if (cat === "frontend" || cat === "devops") return null;

  // Ignore catch-all posts listing >4 services so broad posts don't skew one stack.
  const narrowServices =
    Array.isArray(post.services) && post.services.length > 0 && post.services.length <= 4
      ? post.services
      : [];
  const text = `${String(post.slug || "").replace(/-/g, " ")} ${post.title || ""} ${post.keyword || ""}`;

  if (cat === "ai engineering" || narrowServices.some((s) => AI_SERVICES.has(s))) {
    return "AI Engineering and Integration";
  }
  if (
    narrowServices.includes("ruby-on-rails-development") ||
    /\b(rails|ruby on rails|ruby|activerecord|hotwire|turbo|sinatra|sidekiq)\b/i.test(text)
  ) {
    return "Rails";
  }
  if (
    narrowServices.includes("python-fastapi-development") ||
    /\b(python|fastapi|django|flask|pydantic|pytest|uv)\b/i.test(text)
  ) {
    return "Python";
  }
  if (/\b(rust|cargo|tokio|rustc|axum|actix|crate)\b/i.test(text)) {
    return "Rust";
  }
  if (/\b(golang|goroutine|gin|fiber|chi)\b/i.test(text) || /\bgo\b/i.test(text)) {
    return "Go";
  }
  if (
    narrowServices.includes("nodejs-typescript-development") ||
    /\b(node\.?js|nodejs|node|typescript|nestjs|fastify|hono|express)\b/i.test(text)
  ) {
    return "Node";
  }
  return null;
}

export function countFullstackwebTopics(posts) {
  const counts = {};
  for (const post of posts || []) {
    const topic = classifyFullstackwebTopic(post);
    if (topic) counts[topic] = (counts[topic] ?? 0) + 1;
  }
  return counts;
}
