import assert from "node:assert/strict";
import { CATEGORY_VALUES, normalizeCategory, validateArticle } from "./fullstackweb-blog-writer.mjs";

assert.deepEqual(CATEGORY_VALUES, [
  "AI Engineering",
  "Backend",
  "Frontend",
  "Dev Tools",
  "DevOps",
  "Node.js and TypeScript",
  "Python and FastAPI",
  "Rust",
  "Engineering Leadership",
]);

// Exact and case/whitespace matches
assert.equal(normalizeCategory("AI Engineering"), "AI Engineering");
assert.equal(normalizeCategory("  node.js and typescript "), "Node.js and TypeScript");

// Legacy category aliases
assert.equal(normalizeCategory("AI/LLM"), "AI Engineering");
assert.equal(normalizeCategory("Web/Frontend"), "Frontend");
assert.equal(normalizeCategory("Infra/DevOps"), "DevOps");
assert.equal(normalizeCategory("Data"), "Backend");
assert.equal(normalizeCategory("Ruby on Rails"), "Backend");

// Unknown / empty / injection inputs fall back cleanly via context or default
assert.equal(normalizeCategory("Machine Learning", { title: "Building FastAPI RAG", services: ["python-fastapi-development"] }), "Python and FastAPI");
assert.equal(normalizeCategory("Other", { title: "React 19 Compiler Guide", keyword: "react compiler" }), "Frontend");
assert.equal(normalizeCategory("Other", { title: "Rust Async Runtime Tuning" }), "Rust");
assert.equal(normalizeCategory("Other", { title: "Kubernetes Deployment Patterns" }), "DevOps");
assert.equal(normalizeCategory("Other", { title: "Staff Engineer Architecture Reviews" }), "Engineering Leadership");
assert.equal(normalizeCategory("Foo\nbar: baz", { title: "Unclassified Note" }), "Dev Tools");
assert.equal(normalizeCategory("", {}), "Dev Tools");
assert.equal(normalizeCategory(null, {}), "Dev Tools");

// validateArticle normalizes off-list category instead of failing or passing stale value through
const body = [
  "Ai agents in TypeScript coordinate tool calls, structured schemas, and deterministic retries across production workflows.",
  "",
  "## Intro",
  "",
  "word ".repeat(1500),
  "",
  "See [my AI Engineering service](/services/ai-engineering/), [get in touch](/contact/), and the [TypeScript docs](https://www.typescriptlang.org/docs/).",
  "",
  "## Details",
  "",
  "```ts\nconst x = 1;\n```",
  "",
  "| Step | Purpose |\n| --- | --- |\n| Validate | Guard schema |",
  "",
  "## Tradeoffs",
  "",
  "> Verification note: test fixture.",
  "",
  "## Frequently asked questions",
  "",
  "### Why validate agent outputs?",
  "",
  "Schema checks catch malformed tool inputs early.",
  "",
  "### Should retries be bounded?",
  "",
  "Yes, cap retries to avoid runaway latency.",
  "",
  "### How should prompts stay deterministic?",
  "",
  "Keep explicit constraints and typed outputs.",
  "",
  "## Conclusion",
  "",
  "Start small and [get in touch](/contact/) if you need help.",
].join("\n");
const article = {
  title: "Building Scalable AI Agents with TypeScript",
  description: "Practical guide to building scalable AI agents with TypeScript, schema validation, and deterministic workflows in production.",
  keyword: "ai agents",
  slug: "building-scalable-ai-agents-ts",
  category: "AI/LLM",
  services: ["ai-engineering"],
  coverAlt: "Diagram of AI agent pipeline",
  body,
};
const res = validateArticle(article, []);
assert.equal(res.ok, true, `expected valid article, got: ${res.errs.join("; ")}`);
assert.equal(article.category, "AI Engineering");

console.log("fullstackweb-category-selfcheck: ok");
