import assert from "node:assert/strict";
import {
  CATEGORY_VALUES,
  SERVICE_VALUES,
  FABRICATED_EXPERIENCE,
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
const okRes = validateArticle({ ...base }, []);
assert.equal(okRes.ok, true, `expected stub article valid, got: ${okRes.errs.join("; ")}`);

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

console.log("hendranicholas-blog-selfcheck: ok");
