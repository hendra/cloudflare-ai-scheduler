import assert from "node:assert/strict";
import { classifyFullstackwebTopic } from "./blog-topic-mix.mjs";
import {
  CATEGORY_VALUES,
  normalizeCategory,
  stubArticle,
  targetCategoryForTopic,
  validateArticle,
  validateTopicCandidate,
} from "./fullstackweb-blog-writer.mjs";

assert.deepEqual(CATEGORY_VALUES, [
  "AI Engineering",
  "Backend",
  "Frontend",
  "DevOps",
]);

// Exact and case/whitespace matches
assert.equal(normalizeCategory("AI Engineering"), "AI Engineering");
assert.equal(normalizeCategory("  backend "), "Backend");
assert.equal(normalizeCategory("FRONTEND"), "Frontend");
assert.equal(normalizeCategory("devops"), "DevOps");

// Legacy category aliases -> 4 categories
assert.equal(normalizeCategory("AI/LLM"), "AI Engineering");
assert.equal(normalizeCategory("Dev Tools"), "AI Engineering");
assert.equal(normalizeCategory("Web/Frontend"), "Frontend");
assert.equal(normalizeCategory("Infra/DevOps"), "DevOps");
assert.equal(normalizeCategory("Data"), "Backend");
assert.equal(normalizeCategory("Python and FastAPI"), "Backend");
assert.equal(normalizeCategory("Node.js and TypeScript"), "Backend");
assert.equal(normalizeCategory("Rust"), "Backend");
assert.equal(normalizeCategory("Ruby on Rails"), "Backend");
assert.equal(normalizeCategory("Engineering Leadership"), "Backend");

// Unknown / empty / injection inputs fall back cleanly via context or default ("Backend")
assert.equal(
  normalizeCategory("Machine Learning", { title: "Building FastAPI RAG", services: ["python-fastapi-development"] }),
  "AI Engineering",
);
assert.equal(normalizeCategory("Other", { title: "React 19 Compiler Guide", keyword: "react compiler" }), "Frontend");
assert.equal(normalizeCategory("Other", { title: "Rust Async Runtime Tuning" }), "Backend");
assert.equal(normalizeCategory("Other", { title: "Kubernetes Deployment Patterns" }), "DevOps");
assert.equal(normalizeCategory("Other", { title: "Staff Engineer Architecture Reviews" }), "Backend");
assert.equal(normalizeCategory("Foo\nbar: baz", { title: "Unclassified Note" }), "Backend");
assert.equal(normalizeCategory("", {}), "Backend");
assert.equal(normalizeCategory(null, {}), "Backend");

// targetCategoryForTopic
assert.equal(targetCategoryForTopic("AI Engineering and Integration"), "AI Engineering");
assert.equal(targetCategoryForTopic("Go"), "Backend");
assert.equal(targetCategoryForTopic("Rails"), "Backend");
assert.equal(targetCategoryForTopic("Python"), "Backend");
assert.equal(targetCategoryForTopic("Rust"), "Backend");
assert.equal(targetCategoryForTopic("Node"), "Backend");

// validateTopicCandidate
const nodeCandidate = {
  signalIndex: 1,
  topic: "Node.js stream backpressure",
  keyword: "nodejs streams",
  title: "Handling Stream Backpressure in Node.js",
  slug: "nodejs-stream-backpressure",
  category: "Backend",
  services: ["nodejs-typescript-development"],
};
const railsReject = validateTopicCandidate(nodeCandidate, {
  targetTopic: "Rails",
  targetCategory: "Backend",
  signalCount: 3,
});
assert.equal(railsReject.ok, false);
assert.match(railsReject.reason, /Rails/);

const negIdx = validateTopicCandidate(
  { ...nodeCandidate, signalIndex: -1 },
  { targetTopic: "Node", targetCategory: "Backend", signalCount: 3 },
);
assert.equal(negIdx.ok, false);

const overIdx = validateTopicCandidate(
  { ...nodeCandidate, signalIndex: 4 },
  { targetTopic: "Node", targetCategory: "Backend", signalCount: 3 },
);
assert.equal(overIdx.ok, false);

for (const badIdx of ["   ", [], "", null]) {
  const resBad = validateTopicCandidate(
    { ...nodeCandidate, signalIndex: badIdx },
    { targetTopic: "Node", targetCategory: "Backend", signalCount: 3 },
  );
  assert.equal(resBad.ok, false, `expected signalIndex ${JSON.stringify(badIdx)} rejected`);
}

const strZeroOk = validateTopicCandidate(
  { ...nodeCandidate, signalIndex: "0" },
  { targetTopic: "Node", targetCategory: "Backend", signalCount: 3 },
);
assert.equal(strZeroOk.ok, true, `expected string "0" valid, got: ${strZeroOk.reason}`);
assert.equal(strZeroOk.signalIndex, 0);

const goOk = validateTopicCandidate(
  {
    signalIndex: 0,
    topic: "Go goroutine worker pools",
    keyword: "go goroutine worker pool",
    title: "Bounded Goroutine Worker Pools in Go",
    slug: "bounded-goroutine-worker-pools-go",
    category: "Backend",
    services: ["backend-api-development"],
  },
  { targetTopic: "Go", targetCategory: "Backend", signalCount: 0 },
);
assert.equal(goOk.ok, true, `expected Go candidate valid, got: ${goOk.reason}`);
assert.equal(goOk.signalIndex, 0);

// stubArticle alignment across stacks
for (const targetTopic of ["Rust", "AI Engineering and Integration", "Python", "Go", "Rails", "Node"]) {
  const stub = stubArticle(targetTopic);
  const res = validateArticle({ ...stub }, []);
  assert.equal(res.ok, true, `expected stubArticle(${JSON.stringify(targetTopic)}) valid, got: ${res.errs.join("; ")}`);
  assert.equal(stub.category, targetCategoryForTopic(targetTopic));
  assert.equal(classifyFullstackwebTopic(stub), targetTopic);
}

// validateArticle normalizes off-list category instead of failing or passing stale value through
const baseStub = stubArticle("AI Engineering and Integration");
const legacyArticle = {
  ...baseStub,
  category: "AI/LLM",
};
const res = validateArticle(legacyArticle, []);
assert.equal(res.ok, true, `expected valid article, got: ${res.errs.join("; ")}`);
assert.equal(legacyArticle.category, "AI Engineering");

console.log("fullstackweb-category-selfcheck: ok");
