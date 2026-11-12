// Assert-based self-check for the blog cover pipeline (no framework).
// Run: npm run cover:selfcheck
import assert from "node:assert/strict";
import { escapeXml, parseCoverSpec, coverAltFromSpec, coverSpecPrompt, STUB_SPEC } from "./spec.mjs";

const good = {
  eyebrow: "rails pgvector",
  title: "pgvector",
  subtitle: ["Vector search in PostgreSQL", "with Rails"],
  bullets: ["a", "b", "c"],
  diagram: {
    nodes: [{ label: "Document", sub: "title + body" }, { label: "Embed job", kind: "accent" }, { label: "Chunks", lines: ["embedding vector(768)"] }],
    edges: [[0, 1], [1, 2]],
  },
};

// ---- spec contract ----
assert.equal(escapeXml(`R&D <x> "q"`), "R&amp;D &lt;x&gt; &quot;q&quot;");
let r = parseCoverSpec("Sure!\n```json\n" + JSON.stringify(good) + "\n```");
assert.equal(r.ok, true);
assert.equal(r.spec.diagram.nodes[0].kind, "card");
assert.deepEqual(r.spec.diagram.nodes[0].lines, []);
const longTitle = parseCoverSpec(JSON.stringify({ ...good, title: "A very long cover title that is way past thirty" }));
assert.equal(longTitle.ok, true);
assert.ok(longTitle.spec.title.length <= 30);
assert.equal(parseCoverSpec(JSON.stringify({ ...good, bullets: ["a", "b"] })).ok, false);
assert.equal(parseCoverSpec(JSON.stringify({ ...good, diagram: { ...good.diagram, edges: [[2, 1]] } })).ok, false);
assert.equal(parseCoverSpec(JSON.stringify({ ...good, diagram: { nodes: [good.diagram.nodes[0]], edges: [] } })).ok, false);
assert.equal(parseCoverSpec(JSON.stringify({ ...good, diagram: { ...good.diagram, nodes: [{ label: "x", kind: "blob" }, good.diagram.nodes[1]] } })).ok, false);
assert.equal(parseCoverSpec("no json here").ok, false);
assert.equal(coverAltFromSpec(r.spec), "Diagram: Document → Embed job → Chunks");
assert.match(coverSpecPrompt({ site: "inasoft", title: "T", keyword: "k", body: "Intro.\n\n## Satu\n\n## Dua" }), /Indonesia[n]?/i);
assert.match(coverSpecPrompt({ site: "railsdev", title: "T", keyword: "k", body: "Intro.\n\n## One\n\n## Two" }), /One[\s\S]*Two/);
assert.equal(parseCoverSpec(JSON.stringify(STUB_SPEC)).ok, true);

console.log("cover self-check: ok");
