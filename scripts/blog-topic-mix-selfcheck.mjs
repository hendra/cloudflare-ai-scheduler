// Assert-based self-check for scripts/blog-topic-mix.mjs (no framework, offline).
// Run: node scripts/blog-topic-mix-selfcheck.mjs
import assert from "node:assert/strict";

const {
  pickCategory,
  HENDRANICHOLAS_SHARES,
  FULLSTACKWEB_SHARES,
  classifyFullstackwebTopic,
  countFullstackwebTopics,
} = await import("./blog-topic-mix.mjs");

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

// FullstackWeb 6-stack shares converge exactly over 100 picks.
const fswCounts = {};
for (let i = 0; i < 100; i++) {
  const c = pickCategory(FULLSTACKWEB_SHARES, fswCounts);
  fswCounts[c] = (fswCounts[c] ?? 0) + 1;
}
assert.deepEqual(fswCounts, {
  Python: 20,
  Rust: 20,
  Node: 20,
  "AI Engineering and Integration": 20,
  Go: 15,
  Rails: 5,
});

// Direct classifications across all 6 stacks (including AI priority over Node).
assert.equal(
  classifyFullstackwebTopic({ slug: "django-vs-fastapi", category: "Backend", services: ["python-fastapi-development"] }),
  "Python",
);
assert.equal(
  classifyFullstackwebTopic({ slug: "rust-1-99-c-variadic-functions", title: "Rust 1.99: Cargo Changes", category: "Backend", services: ["backend-api-development"] }),
  "Rust",
);
assert.equal(
  classifyFullstackwebTopic({ slug: "go-1-27-generic-methods", title: "Go 1.27 Generic Methods", category: "Backend", services: ["backend-api-development"] }),
  "Go",
);
assert.equal(
  classifyFullstackwebTopic({ slug: "hotwire-turbo-streams-guide", title: "Hotwire Turbo Streams", category: "Backend", services: [] }),
  "Rails",
);
assert.equal(
  classifyFullstackwebTopic({ slug: "temporal-api-nodejs-26", title: "Temporal in Node.js 26", category: "Backend", services: ["nodejs-typescript-development"] }),
  "Node",
);
assert.equal(
  classifyFullstackwebTopic({
    slug: "protecting-codebase-openai-codex-security-typescript",
    title: "Codex Security in TypeScript",
    category: "AI Engineering",
    services: ["nodejs-typescript-development"],
  }),
  "AI Engineering and Integration",
);

// Review Focus edge cases:
// 1. "go" substring false-positive guard ("google", "going", "mongodb", "algorithms" -> null; "django" -> Python, not Go).
assert.equal(
  classifyFullstackwebTopic({ slug: "google-cloud-guide", title: "Going Beyond Algorithms with MongoDB", category: "Backend", services: [] }),
  null,
);
assert.equal(
  classifyFullstackwebTopic({ slug: "google-cloud-django-guide", title: "Going Beyond Algorithms with MongoDB", category: "Backend", services: [] }),
  "Python",
);
// 2. Frontend / DevOps scope guard.
assert.equal(
  classifyFullstackwebTopic({ slug: "embed-ai-agents-react-nextjs-ag-ui", title: "Embed AI Agents in React", category: "Frontend", services: ["ai-engineering", "ai-agent-development"] }),
  null,
);
assert.equal(
  classifyFullstackwebTopic({ slug: "arcane-modern-docker-management", title: "Arcane Docker", category: "DevOps", services: ["cloud-devops"] }),
  null,
);
// 3. Catch-all services guard (> 4 services ignored).
assert.equal(
  classifyFullstackwebTopic({
    slug: "api-versioning-mastery",
    title: "Mastering API Versioning",
    category: "Backend",
    services: [
      "full-stack-development",
      "nodejs-typescript-development",
      "react-nextjs-development",
      "backend-api-development",
      "cloud-devops",
      "ruby-on-rails-development",
      "python-fastapi-development",
      "ai-engineering",
      "ai-agent-development",
      "rag-llm-development",
    ],
  }),
  null,
);

// countFullstackwebTopics skips null posts and tallies matching buckets accurately.
assert.deepEqual(
  countFullstackwebTopics([
    { slug: "django-vs-fastapi", category: "Backend", services: ["python-fastapi-development"] },
    { slug: "python-3-15-lazy-imports", category: "Backend", services: ["python-fastapi-development"] },
    { slug: "rust-1-99-c-variadic-functions", title: "Rust 1.99", category: "Backend", services: [] },
    { slug: "go-1-27-generic-methods", title: "Go 1.27", category: "Backend", services: [] },
    { slug: "embed-ai-agents-react-nextjs-ag-ui", title: "Embed AI Agents", category: "Frontend", services: ["ai-engineering"] },
    { slug: "api-versioning-mastery", title: "API Versioning", category: "Backend", services: [] },
  ]),
  { Python: 2, Rust: 1, Go: 1 },
);

console.log("topic-mix self-check: ok");
