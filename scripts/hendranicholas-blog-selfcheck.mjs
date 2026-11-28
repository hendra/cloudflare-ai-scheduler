import assert from "node:assert/strict";
import {
  CATEGORY_VALUES,
  SERVICE_VALUES,
  FABRICATED_EXPERIENCE,
  normalizeCategory,
  validateArticle,
  stubArticle,
} from "./hendranicholas-blog-writer.mjs";

assert.deepEqual(CATEGORY_VALUES, [
  "Next.js",
  "FastAPI",
  "Rust",
  "Go",
  "Ruby on Rails",
  "AI Integration",
]);

assert.equal(SERVICE_VALUES.length, 9);
assert.ok(Array.isArray(FABRICATED_EXPERIENCE) && FABRICATED_EXPERIENCE.length >= 5);

const base = stubArticle();
assert.ok(base.seoTitle.length >= 32 && base.seoTitle.length <= 42, `expected stub seoTitle 32-42c, got ${base.seoTitle?.length}`);
assert.ok(base.description.length >= 120 && base.description.length <= 160, `expected stub description 120-160c, got ${base.description.length}`);
const okRes = validateArticle({ ...base }, []);
assert.equal(okRes.ok, true, `expected stub article valid, got: ${okRes.errs.join("; ")}`);
assert.equal(validateArticle({ ...base, seoTitle: "Too short" }, []).ok, false);
assert.equal(validateArticle({ ...base, seoTitle: "x".repeat(43) }, []).ok, false);
assert.equal(validateArticle({ ...base, description: "Too short description under 120 chars." }, []).ok, false);

const fabricated = {
  ...base,
  body: base.body.replace(
    "## Verification",
    "When I migrated a client's FastAPI service, latency dropped.\n\n## Verification",
  ),
};
const fabRes = validateArticle(fabricated, []);
assert.equal(fabRes.ok, false, "expected fabricated experience to fail validation");
assert.ok(
  fabRes.errs.some((e) => /fabricated experience/i.test(e)),
  `expected fabricated experience error, got: ${fabRes.errs.join("; ")}`,
);

const opinion = {
  ...base,
  body: base.body.replace(
    "## Verification",
    "I recommend Pydantic v2 for strict request validation.\n\n## Verification",
  ),
};
const opRes = validateArticle(opinion, []);
assert.equal(opRes.ok, true, `expected first-person recommendation valid, got: ${opRes.errs.join("; ")}`);

assert.equal(normalizeCategory("Ruby on Rails", { title: "When to go beyond Rails" }), "Ruby on Rails");
assert.equal(normalizeCategory("", { title: "When to go beyond Rails" }), "Ruby on Rails");
assert.equal(normalizeCategory("", { title: "When to go beyond" }), "Next.js");
assert.equal(normalizeCategory("", { title: "Concurrency in Go" }), "Go");
assert.equal(normalizeCategory("go"), "Go");

console.log("hendranicholas-blog-selfcheck: ok");

// hendranicholas.com is one person: "our team" is a validation error.
const teamVoice = validateArticle({ ...base, body: base.body + "\n\nOur team builds these systems.\n" }, []);
assert.equal(teamVoice.ok, false);
assert.ok(teamVoice.errs.some((e) => e.startsWith('banned phrase "Our team"')), teamVoice.errs.join("; "));
